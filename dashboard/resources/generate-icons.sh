#!/usr/bin/env bash
# Regenerate the iOS app icon and launch images.
#
# The mark is the existing brand glyph (a disc with a triangle) rendered in the
# app's accent with a vertical gradient, on the warm-dark surface ramp — the
# same colours the UI uses, so the icon and the app look like one product.
#
# Needs ImageMagick. Run from the dashboard directory:
#
#   ./resources/generate-icons.sh
#
# Outputs (committed; the CI shell build injects them into the generated Xcode
# project — see .github/workflows/ios-capacitor.yml):
#   resources/icon.png        1024x1024, opaque — iOS app icon
#   resources/splash.png      2732x2732 launch image, dark canvas
#   resources/splash-dark.png same, for dark appearance

set -euo pipefail

cd "$(dirname "$0")/.."
OUT=resources
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Surface ramp (top lighter), matching --canvas and the card surfaces.
convert -size 1024x1024 gradient:'#22222b'-'#0e0e12' "$TMP/bg.png"
# Accent ramp, matching --accent-hover → --accent-2.
convert -size 1024x1024 gradient:'#82abf8'-'#3f60bd' "$TMP/accent.png"
# Disc: 660px diameter, centred, with margin for the rounded-square mask iOS applies.
convert -size 1024x1024 xc:black -fill white -draw 'circle 512,512 512,182' "$TMP/mask.png"
convert "$TMP/accent.png" "$TMP/mask.png" -alpha off -compose copy_opacity -composite "$TMP/disc.png"
# Soft halo so the disc sits in the background rather than on it.
convert "$TMP/disc.png" -channel A -evaluate multiply 0.5 +channel -blur 0x60 "$TMP/glow.png"

convert "$TMP/bg.png" "$TMP/glow.png" -compose over -composite \
  "$TMP/disc.png" -compose over -composite \
  -fill '#0e0e12' -draw 'polygon 512,390 648,620 376,620' \
  -alpha remove -alpha off -depth 8 "$OUT/icon.png"

# The mark on its own, for the launch image.
convert "$TMP/disc.png" -fill '#0e0e12' -draw 'polygon 512,390 648,620 376,620' \
  -resize 560x560 "$TMP/mark.png"

for target in splash splash-dark; do
  convert -size 2732x2732 xc:'#131315' "$TMP/mark.png" -gravity center -composite \
    -depth 8 "$OUT/$target.png"
done

identify "$OUT/icon.png" "$OUT/splash.png"
