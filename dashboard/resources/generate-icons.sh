#!/usr/bin/env bash
# Regenerate the iOS app icon and launch images.
#
# The mark: a stack of two rounded cards (the "deck") in the app's surfaces, the
# top card in the accent ramp, with a terminal prompt — chevron plus cursor —
# knocked out of it. That reads as the product rather than as a media player,
# and the silhouette survives being scaled to a home-screen icon.
#
# Colours come from the same ramp the UI uses, so icon and app match.
#
# Needs ImageMagick. Run from the dashboard directory:
#
#   ./resources/generate-icons.sh
#
# Outputs (committed; the CI shell build injects them into the generated Xcode
# project — see .github/workflows/ios-capacitor.yml):
#   resources/icon.png        1024x1024, opaque — iOS app icon
#   resources/splash.png      2732x2732 launch image, canvas colour
#   resources/splash-dark.png same

set -euo pipefail

cd "$(dirname "$0")/.."
OUT=resources
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

INK='#0e0e12'          # glyph knockout, matches the background's dark end
CARD_FRONT_A='#82abf8' # ~--accent-hover
CARD_FRONT_B='#3f60bd' # ~--accent-2
CARD_BACK_A='#43434f'
CARD_BACK_B='#2a2a33'

# Background: the surface ramp, light at the top like the app's canvas glow.
convert -size 1024x1024 gradient:'#22222b'-#0e0e12 "$TMP/bg.png"

# ── The mark on its own (transparent), reused for the launch image ──────────
# Back card: graphite ramp, offset down-right so it peeks out as a stack.
convert -size 1024x1024 gradient:"$CARD_BACK_A-$CARD_BACK_B" "$TMP/back_ramp.png"
convert -size 1024x1024 xc:black -fill white -draw 'roundrectangle 236,212 860,836 132,132' "$TMP/back_mask.png"
convert "$TMP/back_ramp.png" "$TMP/back_mask.png" -alpha off -compose copy_opacity -composite "$TMP/back.png"

# Front card: accent ramp through its own rounded-rect mask.
convert -size 1024x1024 gradient:"$CARD_FRONT_A-$CARD_FRONT_B" "$TMP/accent.png"
convert -size 1024x1024 xc:black -fill white -draw 'roundrectangle 172,148 796,772 132,132' "$TMP/card_mask.png"
convert "$TMP/accent.png" "$TMP/card_mask.png" -alpha off -compose copy_opacity -composite "$TMP/front.png"

# Stack them back-then-front; order matters or the front card disappears.
convert "$TMP/back.png" "$TMP/front.png" -compose over -composite "$TMP/mark.png"

# Prompt glyph, knocked out of the top card.
# Chevron (round caps/joins) + cursor bar, group centred in the card. Line caps
# and joins are MVG primitives here — ImageMagick 6 has no CLI flag for them.
convert "$TMP/mark.png" -draw "
  fill none stroke $INK stroke-width 58 stroke-linecap round stroke-linejoin round
  path 'M 330,338 L 450,460 L 330,582'
  stroke none fill $INK
  roundrectangle 500,431 640,489 29,29
" "$TMP/mark_glyph.png"

# ── App icon: the mark haloed onto the background, opaque ──────────────────
convert "$TMP/mark_glyph.png" -channel A -evaluate multiply 0.45 +channel -blur 0x48 "$TMP/halo.png"
convert "$TMP/bg.png" "$TMP/halo.png" -compose over -composite \
  "$TMP/mark_glyph.png" -compose over -composite \
  -alpha remove -alpha off -depth 8 "$OUT/icon.png"

# ── Launch images: the mark centred on the canvas colour ───────────────────
convert "$TMP/mark_glyph.png" -resize 620x620 "$TMP/mark_small.png"
for target in splash splash-dark; do
  convert -size 2732x2732 xc:'#131315' "$TMP/mark_small.png" -gravity center -composite \
    -depth 8 "$OUT/$target.png"
done

identify "$OUT/icon.png" "$OUT/splash.png"
