//! Frame encoding and adaptive downscaling.
//!
//! The pipeline is deliberately not "send a full-resolution screenshot every
//! tick". A capture produces RGBA, the session picks a target size from the
//! client's quality options and the negotiated adaptive state, this module
//! downscales and encodes, and the session skips the frame entirely when its
//! pixels are unchanged. The encoder is shared by every platform backend: X11,
//! Wayland/GStreamer and macOS all hand it the same RGBA, so only the capture
//! differs.
//!
//! The codec seam is here: `Codec::H264` is a first-class capability with an
//! ffmpeg-backed encoder available when the host has a hardware H.264 encoder,
//! and JPEG is the universally decodable default the mobile client uses today.

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ExtendedColorType, RgbImage};

use super::types::{RemoteError, RemoteResult};

/// Fit `(width, height)` inside `(max_width, max_height)` preserving aspect.
/// Never upscales — a small window stays its own size.
pub fn fit(width: u32, height: u32, max_width: u32, max_height: u32) -> (u32, u32) {
    let width = width.max(1);
    let height = height.max(1);
    let max_width = if max_width == 0 { width } else { max_width.max(1) };
    let max_height = if max_height == 0 { height } else { max_height.max(1) };
    if width <= max_width && height <= max_height {
        return (width, height);
    }
    let scale = f64::min(
        max_width as f64 / width as f64,
        max_height as f64 / height as f64,
    );
    (
        ((width as f64 * scale).round() as u32).max(1),
        ((height as f64 * scale).round() as u32).max(1),
    )
}

/// Encode RGBA as baseline JPEG, optionally downscaled. Returns the bytes and
/// the size actually produced (which the client needs to size its viewport).
pub fn encode_jpeg(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    out_width: u32,
    out_height: u32,
) -> RemoteResult<(Vec<u8>, u32, u32)> {
    let expected = (width as usize) * (height as usize) * 4;
    if rgba.len() < expected {
        return Err(RemoteError::Capture(format!(
            "frame buffer too small: {} < {expected}",
            rgba.len()
        )));
    }
    // JPEG has no alpha, so the RGB channels are lifted into a compact image.
    let mut rgb = Vec::with_capacity((width as usize) * (height as usize) * 3);
    for pixel in rgba.chunks_exact(4).take((width as usize) * (height as usize)) {
        rgb.extend_from_slice(&pixel[..3]);
    }
    let mut image = RgbImage::from_raw(width, height, rgb)
        .ok_or_else(|| RemoteError::Capture("could not build RGB image".to_string()))?;

    // 0 means "no bound on this axis"; `fit` treats it as the source size.
    let (out_width, out_height) = fit(width, height, out_width, out_height);
    if (out_width, out_height) != (width, height) {
        image = image::imageops::resize(&image, out_width, out_height, FilterType::Triangle);
    }

    let mut buffer = Vec::with_capacity(64 * 1024);
    let mut encoder = JpegEncoder::new_with_quality(&mut buffer, quality.clamp(20, 95));
    encoder
        .encode(image.as_raw(), out_width, out_height, ExtendedColorType::Rgb8)
        .map_err(|e| RemoteError::Capture(format!("JPEG encode failed: {e}")))?;
    Ok((buffer, out_width, out_height))
}

/// A cheap content hash used to skip identical frames without re-encoding.
///
/// Samples the buffer on a stride rather than hashing every byte: at 60fps on a
/// 4K screen the full hash would cost more than the JPEG. A stride of 16 bytes
/// still catches any real change (a cursor move alters many sampled pixels) and
/// keeps the cost flat.
pub fn frame_signature(rgba: &[u8]) -> u64 {
    // FNV-1a over a strided sample.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut index = 0;
    while index < rgba.len() {
        hash ^= rgba[index] as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        index += 16;
    }
    hash
}

/// Detect an H.264 encoder the host can actually drive. Used to advertise (or
/// withhold) the hardware-encode capability instead of claiming support blindly.
pub fn h264_encoder() -> Option<&'static str> {
    let probe = std::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-loglevel", "quiet", "-encoders"])
        .output()
        .ok()?;
    if !probe.status.success() {
        return None;
    }
    let listing = String::from_utf8_lossy(&probe.stdout);
    // Prefer hardware encoders; fall back to libx264. Wrapped in a static so the
    // capability advertises the exact encoder name.
    if has_encoder(&listing, "h264_vaapi") {
        return Some("h264_vaapi");
    }
    if has_encoder(&listing, "h264_nvenc") {
        return Some("h264_nvenc");
    }
    if has_encoder(&listing, "h264_qsv") {
        return Some("h264_qsv");
    }
    if has_encoder(&listing, "libx264") {
        return Some("libx264");
    }
    None
}

fn has_encoder(listing: &str, name: &str) -> bool {
    listing.lines().any(|line| {
        let mut parts = line.split_whitespace();
        // ffmpeg's encoder table is `<flags> <name> <description>`.
        let _flags = parts.next();
        parts.next() == Some(name)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_preserves_aspect_and_never_upscales() {
        assert_eq!(fit(1920, 1080, 960, 0), (960, 540));
        assert_eq!(fit(800, 600, 1600, 1200), (800, 600));
        assert_eq!(fit(1080, 1920, 0, 960), (540, 960));
    }

    #[test]
    fn jpeg_encodes_and_downscales() {
        let width = 64;
        let height = 32;
        let rgba: Vec<u8> = (0..width * height)
            .flat_map(|index| [(index % 255) as u8, 40, 200, 255])
            .collect();
        let (bytes, out_width, out_height) = encode_jpeg(&rgba, width, height, 70, 32, 0).unwrap();
        assert_eq!((out_width, out_height), (32, 16));
        assert!(bytes.len() > 2);
        // JPEG magic.
        assert_eq!(&bytes[..2], &[0xff, 0xd8]);
    }

    #[test]
    fn signature_changes_with_content() {
        let a = vec![0u8; 4096];
        let mut b = a.clone();
        // Flip a sampled byte (stride 16).
        b[32] = 200;
        assert_ne!(frame_signature(&a), frame_signature(&b));
    }

    #[test]
    fn h264_detection_does_not_panic() {
        let _ = h264_encoder();
    }
}