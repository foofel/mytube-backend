#!/usr/bin/env bash
set -euo pipefail

IN="${1:?input video path required}"
OUT_DIR="${2:?output dir required}"   # e.g. /var/www/videos/my-video
NAME="$(basename "$OUT_DIR")"

mkdir -p "$OUT_DIR"

# --- General settings ---
# Choose ~2s GOP for your common FPS (24->48, 25->50, 30->60, 50->100, 60->120)
GOP=50
HLS_TIME=4
PRESET=veryfast
AUDIO_BPS_1080P_PLUS=160k
AUDIO_BPS_LOW=128k

# --- Detect if the input has an audio stream ---
HAS_AUDIO="$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$IN" || true)"

# --- Detect input pixel format ---
INPUT_PIXFMT="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "$IN" || true)"

# Fallback to yuv420p if detection fails or format is incompatible with H.264
case "$INPUT_PIXFMT" in
  yuv420p|yuv422p|yuv444p|yuvj420p|yuvj422p|yuvj444p)
    # These are compatible with H.264
    PIXFMT="$INPUT_PIXFMT"
    ;;
  *)
    # Fallback for incompatible or undetected formats
    PIXFMT="yuv420p"
    ;;
esac

echo "[$(date '+%d.%m.%Y %H:%M:%S')] Starting transcode of '$IN' to '$OUT_DIR'"
echo "[$(date '+%d.%m.%Y %H:%M:%S')] Using pixel format: $PIXFMT"

# --- Progressive MP4 fallback ---
if [[ -n "$HAS_AUDIO" ]]; then
  # -hide_banner -nostats -v error -stats_period 0.5
  ffmpeg -hide_banner -y -i "$IN" \
    -map 0:v:0 -map 0:a:0 \
    -map_metadata -1 -map_chapters -1 -sn -dn \
    -c:v libx264 -preset "$PRESET" -crf 21 -movflags +faststart \
    -pix_fmt "$PIXFMT" -profile:v high \
    -c:a aac -b:a "$AUDIO_BPS_1080P_PLUS" -ac 2 \
    "$OUT_DIR/progressive.mp4" #-progress pipe:2
else
  ffmpeg -hide_banner -y -i "$IN" \
    -map 0:v:0 \
    -map_metadata -1 -map_chapters -1 -sn -dn \
    -c:v libx264 -preset "$PRESET" -crf 21 -movflags +faststart \
    -pix_fmt "$PIXFMT" -profile:v high \
    "$OUT_DIR/progressive.mp4" #-progress pipe:2
fi

# --- Filter graph for scaling ---
FILTER_COMPLEX='
[0:v]split=6[v2160][v1440][v1080][v720][v480][v360];
[v2160]scale=w=3840:h=2160:force_original_aspect_ratio=decrease:force_divisible_by=2:eval=frame[v2160o];
[v1440]scale=w=2560:h=1440:force_original_aspect_ratio=decrease:force_divisible_by=2:eval=frame[v1440o];
[v1080]scale=w=1920:h=1080:force_original_aspect_ratio=decrease:force_divisible_by=2:eval=frame[v1080o];
[v720] scale=w=1280:h=720 :force_original_aspect_ratio=decrease:force_divisible_by=2:eval=frame[v720o];
[v480] scale=w=854 :h=480 :force_original_aspect_ratio=decrease:force_divisible_by=2:eval=frame[v480o];
[v360] scale=w=640 :h=360 :force_original_aspect_ratio=decrease:force_divisible_by=2:eval=frame[v360o]
'

# --- Common video opts (without pix_fmt, will be set per-stream) ---
VID_OPTS="-preset $PRESET -g $GOP -keyint_min $GOP -sc_threshold 0"

if [[ -n "$HAS_AUDIO" ]]; then
  echo "[$(date '+%d.%m.%Y %H:%M:%S')] Audio detected, mapping video+audio for all variants"
  ffmpeg -hide_banner -y -i "$IN" \
    -filter_complex "$FILTER_COMPLEX" \
    -map "[v2160o]" -map 0:a:0 -c:v:0 libx264 $VID_OPTS -pix_fmt:v:0 "$PIXFMT" -profile:v:0 high -crf:v:0 20 -maxrate:v:0 70000k -bufsize:v:0 70000k -c:a:0 aac -b:a:0 "$AUDIO_BPS_1080P_PLUS" \
    -map "[v1440o]" -map 0:a:0 -c:v:1 libx264 $VID_OPTS -pix_fmt:v:1 "$PIXFMT" -profile:v:1 high -crf:v:1 20 -maxrate:v:1 32000k -bufsize:v:1 32000k -c:a:1 aac -b:a:1 "$AUDIO_BPS_1080P_PLUS" \
    -map "[v1080o]" -map 0:a:0 -c:v:2 libx264 $VID_OPTS -pix_fmt:v:2 "$PIXFMT" -profile:v:2 high -crf:v:2 21 -maxrate:v:2 20000k -bufsize:v:2 20000k -c:a:2 aac -b:a:2 "$AUDIO_BPS_1080P_PLUS" \
    -map "[v720o]"  -map 0:a:0 -c:v:3 libx264 $VID_OPTS -pix_fmt:v:3 "$PIXFMT" -profile:v:3 high -crf:v:3 22 -maxrate:v:3 14000k -bufsize:v:3 14000k -c:a:3 aac -b:a:3 "$AUDIO_BPS_LOW" \
    -map "[v480o]"  -map 0:a:0 -c:v:4 libx264 $VID_OPTS -pix_fmt:v:4 "$PIXFMT" -profile:v:4 main -crf:v:4 24 -maxrate:v:4 7200k  -bufsize:v:4 7200k  -c:a:4 aac -b:a:4 128k \
    -map "[v360o]"  -map 0:a:0 -c:v:5 libx264 $VID_OPTS -pix_fmt:v:5 "$PIXFMT" -profile:v:5 main -crf:v:5 26 -maxrate:v:5 3600k  -bufsize:v:5 3600k  -c:a:5 aac -b:a:5 96k \
    -map_metadata -1 -map_chapters -1 -sn -dn \
    -f hls \
    -hls_time "$HLS_TIME" -hls_playlist_type vod -hls_flags independent_segments+program_date_time \
    -hls_segment_type fmp4 -hls_fmp4_init_filename "init_%v.mp4" -master_pl_name master.m3u8 \
    -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3 v:4,a:4 v:5,a:5" \
    -hls_segment_filename "$OUT_DIR/%v/seg_%06d.m4s" \
    "$OUT_DIR/%v/index.m3u8"
else
  echo "[$(date '+%d.%m.%Y %H:%M:%S')] No audio detected, producing video-only variants"
  ffmpeg -hide_banner -y -i "$IN" \
    -filter_complex "$FILTER_COMPLEX" \
    -map "[v2160o]" -c:v:0 libx264 $VID_OPTS -pix_fmt:v:0 "$PIXFMT" -profile:v:0 high -crf:v:0 20 -maxrate:v:0 70000k -bufsize:v:0 70000k \
    -map "[v1440o]" -c:v:1 libx264 $VID_OPTS -pix_fmt:v:1 "$PIXFMT" -profile:v:1 high -crf:v:1 20 -maxrate:v:1 32000k -bufsize:v:1 32000k \
    -map "[v1080o]" -c:v:2 libx264 $VID_OPTS -pix_fmt:v:2 "$PIXFMT" -profile:v:2 high -crf:v:2 21 -maxrate:v:2 20000k -bufsize:v:2 20000k \
    -map "[v720o]"  -c:v:3 libx264 $VID_OPTS -pix_fmt:v:3 "$PIXFMT" -profile:v:3 high -crf:v:3 22 -maxrate:v:3 14000k -bufsize:v:3 14000k \
    -map "[v480o]"  -c:v:4 libx264 $VID_OPTS -pix_fmt:v:4 "$PIXFMT" -profile:v:4 main -crf:v:4 24 -maxrate:v:4 7200k  -bufsize:v:4 7200k \
    -map "[v360o]"  -c:v:5 libx264 $VID_OPTS -pix_fmt:v:5 "$PIXFMT" -profile:v:5 main -crf:v:5 26 -maxrate:v:5 3600k  -bufsize:v:5 3600k \
    -map_metadata -1 -map_chapters -1 -sn -dn \
    -f hls \
    -hls_time "$HLS_TIME" -hls_playlist_type vod -hls_flags independent_segments+program_date_time \
    -hls_segment_type fmp4 -hls_fmp4_init_filename "init_%v.mp4" -master_pl_name master.m3u8 \
    -var_stream_map "v:0 v:1 v:2 v:3 v:4 v:5" \
    -hls_segment_filename "$OUT_DIR/%v/seg_%06d.m4s" \
    "$OUT_DIR/%v/index.m3u8"
fi

# --- Poster thumbnail (PNG extraction only, AVIF conversion done in transcode.ts) ---
echo "[$(date '+%d.%m.%Y %H:%M:%S')] Extracting poster frame"
POSTER_SRC="poster_lossless.png"
TS=00:00:02
ffmpeg -hide_banner -nostats -v error -y -ss "$TS" -i "$IN" -frames:v 1 "$OUT_DIR/$POSTER_SRC"
# fallback if TS was after movie length
if [[ ! -s "$OUT_DIR/$POSTER_SRC" ]]; then
  ffmpeg -hide_banner -nostats -v error -y -i "$IN" -vframes 1 -f image2 "$OUT_DIR/$POSTER_SRC"
fi

echo "[$(date '+%d.%m.%Y %H:%M:%S')] Done"
echo "  HLS master: $OUT_DIR/master.m3u8"
echo "  MP4:        $OUT_DIR/progressive.mp4"
echo "  Poster PNG: $OUT_DIR/$POSTER_SRC"