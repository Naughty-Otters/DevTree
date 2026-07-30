#!/usr/bin/env bash
# Convert .mov → .gif in the same folder (requires ffmpeg).
#
# Usage:
#   ./scripts/mov-to-gif.sh                         # all .mov under media/video
#   ./scripts/mov-to-gif.sh media/video/foo.mov     # one file
#   ./scripts/mov-to-gif.sh media/video             # all .mov in a folder
#   ./scripts/mov-to-gif.sh --fps 12 --width 800 media/video
#
# Env overrides: FPS, WIDTH, START, DURATION
set -euo pipefail

FPS="${FPS:-10}"
WIDTH="${WIDTH:-480}"
START="${START:-}"
DURATION="${DURATION:-}"

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \?//'
}

args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --fps) FPS="$2"; shift 2 ;;
    --width) WIDTH="$2"; shift 2 ;;
    --start) START="$2"; shift 2 ;;
    --duration) DURATION="$2"; shift 2 ;;
    --) shift; args+=("$@"); break ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
    *) args+=("$1"); shift ;;
  esac
done

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Install with: brew install ffmpeg" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
default_dir="$root/media/video"

collect_movs() {
  local target="${1:-$default_dir}"
  if [[ -f "$target" ]]; then
    # Always print an absolute path.
    local abs
    abs="$(cd "$(dirname "$target")" && pwd)/$(basename "$target")"
    printf '%s\n' "$abs"
    return
  fi
  if [[ -d "$target" ]]; then
    local abs_dir
    abs_dir="$(cd "$target" && pwd)"
    find "$abs_dir" -maxdepth 1 -type f \( -iname '*.mov' -o -iname '*.MOV' \) | sort
    return
  fi
  echo "Not a file or directory: $target" >&2
  exit 1
}

convert_one() {
  local input="$1"
  local dir base out
  dir="$(cd "$(dirname -- "$input")" && pwd)"
  base="$(basename -- "$input")"
  base="${base%.*}"
  out="${dir}/${base}.gif"

  local -a seek_args=()
  [[ -n "$START" ]] && seek_args+=(-ss "$START")
  [[ -n "$DURATION" ]] && seek_args+=(-t "$DURATION")

  local filter="fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"

  echo "→ $input"
  echo "  fps=$FPS width=$WIDTH"
  ffmpeg -y -nostdin -hide_banner -loglevel error \
    ${seek_args[@]+"${seek_args[@]}"} \
    -i "$input" \
    -vf "$filter" \
    -loop 0 \
    "$out"
  echo "  wrote $out ($(du -h "$out" | awk '{print $1}'))"
}

targets=("${args[@]}")
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=("$default_dir")
fi

count=0
for target in "${targets[@]}"; do
  # Resolve relative paths from repo root when not absolute.
  if [[ "$target" != /* ]]; then
    target="$root/$target"
  fi
  while IFS= read -r mov; do
    [[ -z "$mov" ]] && continue
    convert_one "$mov"
    count=$((count + 1))
  done < <(collect_movs "$target")
done

if [[ "$count" -eq 0 ]]; then
  echo "No .mov files found." >&2
  exit 1
fi

echo "Done ($count gif$([ "$count" -eq 1 ] || echo s))."
