#!/usr/bin/env bash
# Removes the audio track from every animated sprite (upstream.SPRITE_DIR) that has one.
#
# Why: a browser treats any video with an audio track as a video with sound -- even a completely silent track (muting
# it in a video editor keeps the track) -- and Chrome then shows its play/pause control over the sprite on the display
# and the battle screens. With the track gone they're plain moving pictures. The video itself is copied as it is (no
# re-encoding, no quality loss). Run it again whenever new sprites are added; files without audio are left alone.
#
# Usage (on the Pi):  bash ~/pokemon-dnd/pi-server/scripts/strip_sprite_audio.sh
set -euo pipefail

DIR="${SPRITE_DIR:-$HOME/pokemon-dnd/pokemon-sprites}"
cd "$DIR"

stripped=0
for f in *.mp4; do
  [ -e "$f" ] || continue
  if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$f" | grep -q .; then
    ffmpeg -v error -y -i "$f" -map 0:v -c copy -an -movflags +faststart "$f.tmp.mp4"
    mv "$f.tmp.mp4" "$f"
    echo "removed the audio track: $f"
    stripped=$((stripped + 1))
  fi
done
echo "Done -- $stripped file(s) changed in $DIR."
