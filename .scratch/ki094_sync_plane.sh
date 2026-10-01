set -e
cd /d/法环游戏
FILES="src/world/WeatherSwitch.ts tests/unit/weather-switch.test.ts src/main.ts src/vfx/ColorGrade.ts scripts/weather-rules.mjs scripts/weather-rules.d.mts tests/unit/color-grade.test.ts tests/unit/arch-boundaries.test.ts docs/technical-architecture.md docs/KNOWN_ISSUES.md"
for f in $FILES; do
  mkdir -p ".scratch/ki094_plane/$(dirname "$f")"
  cp "$f" ".scratch/ki094_plane/$f"
done
# validate-data.mjs 必须是 HEAD 版 + 我的两个 hunk（工作副本里那些武器 hunk 属于并行会话）
git show HEAD:scripts/validate-data.mjs > .scratch/ki094_plane/scripts/validate-data.mjs
node .scratch/ki094_patch_validator.mjs
echo "SYNCED"
