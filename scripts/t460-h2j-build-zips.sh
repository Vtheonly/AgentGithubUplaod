#!/usr/bin/env bash
# T-460 H2+J delivery zips (the 132nd session) — mirrors the t440/t438/... build-zips pattern:
# the android working-tree zip + the all-systems archive, both excluding .git,
# build outputs, .env (secrets never in archives) and local.properties.
set -euo pipefail

BASE=/home/z/my-project
HUB=$BASE/AgentGithubUplaod
DROID=$BASE/elimtiyaz-android
OUT=$HUB/deliverables
DL=$BASE/download
STAMP="T460-H2J"

mkdir -p "$OUT" "$DL"
cd "$BASE"

# ---- 1. the android zip -----------------------------------------------------
rm -f "$OUT/elimtiyaz-android-$STAMP.zip"
(cd "$BASE" && zip -qr "$OUT/elimtiyaz-android-$STAMP.zip" elimtiyaz-android \
  -x "elimtiyaz-android/.git/*" \
  -x "elimtiyaz-android/.gradle/*" \
  -x "elimtiyaz-android/build/*" \
  -x "elimtiyaz-android/app/build/*" \
  -x "elimtiyaz-android/.env" \
  -x "elimtiyaz-android/local.properties" \
  -x "elimtiyaz-android/.idea/*" \
  -x "elimtiyaz-android/.kotlin/*")

# ---- 2. the all-systems archive ---------------------------------------------
rm -f "$OUT/el-imtiyaz-all-systems-$STAMP.zip"
(cd "$BASE" && zip -qr "$OUT/el-imtiyaz-all-systems-$STAMP.zip" AgentGithubUplaod elimtiyaz-android \
  -x "AgentGithubUplaod/.git/*" \
  -x "AgentGithubUplaod/deliverables/*.zip" \
  -x "AgentGithubUplaod/node_modules/*" \
  -x "AgentGithubUplaod/elimtiyaz-desktop/node_modules/*" \
  -x "AgentGithubUplaod/elimtiyaz-desktop/dist/*" \
  -x "AgentGithubUplaod/elimtiyaz-desktop/release/*" \
  -x "elimtiyaz-android/.git/*" \
  -x "elimtiyaz-android/.gradle/*" \
  -x "elimtiyaz-android/build/*" \
  -x "elimtiyaz-android/app/build/*" \
  -x "elimtiyaz-android/.env" \
  -x "elimtiyaz-android/local.properties" \
  -x "elimtiyaz-android/.idea/*" \
  -x "elimtiyaz-android/.kotlin/*")

# ---- 3. copies for the owner -------------------------------------------------
cp -f "$OUT/elimtiyaz-android-$STAMP.zip" "$DL/"
cp -f "$OUT/el-imtiyaz-all-systems-$STAMP.zip" "$DL/"

echo "---- sizes ----"
du -h "$OUT/elimtiyaz-android-$STAMP.zip" "$OUT/el-imtiyaz-all-systems-$STAMP.zip"
