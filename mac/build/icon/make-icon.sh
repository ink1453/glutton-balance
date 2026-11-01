#!/bin/bash
# 生成「饭桶余额」应用图标：1024 底图 → iconset → app.icns
#
# 产物（都在本目录下）：
#   build/icon/icon-1024.png            1024×1024 底图
#   build/icon/app.iconset/             各尺寸 PNG（16…1024）
#   build/icon/app.icns                 macOS 应用图标（build-app.sh 拷进 .app）
#   build/icon/tray/trayTemplate.png    菜单栏模板图 16×16（主程序读 app/assets/trayTemplate.png）
#   build/icon/tray/trayTemplate@2x.png 同上 @2x（32×32，Retina 清晰）
#
# 用法：
#   ./make-icon.sh            # 已有 app.icns 且比底图新就跳过（幂等）
#   ./make-icon.sh --force    # 强制重画、重出 iconset
#   ./make-icon.sh --preview  # 额外输出 /tmp 小图预览（人眼检查用）
#
# 依赖：只依赖本机已有工具（sips / iconutil / Pillow）。不装任何东西。
# 底图脚本 make-icon.py 里没有任何本机路径、用户名、密钥，可安全进包。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MASTER="$SCRIPT_DIR/icon-1024.png"
ICONSET="$SCRIPT_DIR/app.iconset"
ICNS="$SCRIPT_DIR/app.icns"
TRAY_DIR="$SCRIPT_DIR/tray"
TRAY16="$TRAY_DIR/trayTemplate.png"
TRAY32="$TRAY_DIR/trayTemplate@2x.png"
PY_SCRIPT="$SCRIPT_DIR/make-icon.py"

FORCE=0
PREVIEW=""
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    --preview) PREVIEW="$(mktemp -d /tmp/pbp-icon-preview.XXXXXX)" ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数：${arg}（用 --help 看用法）" >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }

# ---- 1. 找一个带 Pillow 的 python3（本机 DSH 运行时里已有；不装依赖）----
find_python() {
  local candidates=()
  [ -n "${PYTHON:-}" ] && candidates+=("$PYTHON")
  candidates+=(
    "$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/bin/python3"
    "/opt/homebrew/bin/python3"
    "/usr/local/bin/python3"
    "/usr/bin/python3"
  )
  # 兜底：dsh-runtimes 下任意 runtime 的 python3
  local p
  for p in "$HOME"/.dsh/dsh-runtimes/*/dependencies/python/bin/python3; do
    [ -x "$p" ] && candidates+=("$p")
  done
  command -v python3 >/dev/null 2>&1 && candidates+=("$(command -v python3)")
  for p in "${candidates[@]}"; do
    [ -x "$p" ] || continue
    if "$p" -c 'import PIL' >/dev/null 2>&1; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  return 1
}

if [ "$FORCE" -eq 0 ] && [ -f "$ICNS" ] && [ -f "$MASTER" ]; then
  if [ "$ICNS" -nt "$MASTER" ] && [ "$ICNS" -nt "$PY_SCRIPT" ]; then
    say "图标已是最新，跳过：$ICNS"
    say "  （要重画就 ./make-icon.sh --force）"
    exit 0
  fi
fi

command -v sips >/dev/null 2>&1 || { echo "缺少 sips（macOS 自带，不该缺）" >&2; exit 1; }
command -v iconutil >/dev/null 2>&1 || { echo "缺少 iconutil（macOS 自带，不该缺）" >&2; exit 1; }

PY="$(find_python)" || {
  echo "找不到带 Pillow 的 python3。本机通常有：$HOME/.dsh/dsh-runtimes/*/dependencies/python/bin/python3" >&2
  echo "（按任务约束不装新依赖；可显式指定：PYTHON=/path/to/python3 ./make-icon.sh --force）" >&2
  exit 1
}

# ---- 2. 画 1024 应用图标底图 + 菜单栏模板图 ----
say "① 画底图（${PY}）"
if [ -n "$PREVIEW" ]; then
  "$PY" "$PY_SCRIPT" --out "$MASTER" --tray-out "$TRAY_DIR" --preview "$PREVIEW" || exit 1
  say "   预览图：$PREVIEW"
else
  "$PY" "$PY_SCRIPT" --out "$MASTER" --tray-out "$TRAY_DIR" || exit 1
fi

# ---- 3. 出 iconset（macOS 图标要求的 10 个尺寸）----
say "② 生成 iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
make_size() { # size out
  sips -z "$1" "$1" "$MASTER" --out "$ICONSET/$2" >/dev/null 2>&1 || {
    echo "sips 缩放失败：$1 -> $2" >&2; exit 1; }
}
make_size   16 icon_16x16.png
make_size   32 icon_16x16@2x.png
make_size   32 icon_32x32.png
make_size   64 icon_32x32@2x.png
make_size  128 icon_128x128.png
make_size  256 icon_128x128@2x.png
make_size  256 icon_256x256.png
make_size  512 icon_256x256@2x.png
make_size  512 icon_512x512.png
make_size 1024 icon_512x512@2x.png

# ---- 4. 出 icns ----
say "③ 打包成 app.icns"
rm -f "$ICNS"
iconutil -c icns "$ICONSET" -o "$ICNS" || { echo "iconutil 打包失败" >&2; exit 1; }

# ---- 5. 校验（能再解回 iconset 且尺寸齐全）----
VERIFY="$(mktemp -d /tmp/pbp-icon-verify.XXXXXX)"
if iconutil -c iconset "$ICNS" -o "$VERIFY/check.iconset" >/dev/null 2>&1; then
  n="$(ls -1 "$VERIFY/check.iconset" | wc -l | tr -d ' ')"
  say "   ✓ 校验通过：icns 可解回 iconset（$n 个尺寸）"
else
  echo "   ! 警告：icns 解回失败（图标可能仍可用，但建议检查）" >&2
fi
rm -rf "$VERIFY"

SIZE="$(du -h "$ICNS" | awk '{print $1}')"
say ""
say "完成："
say "  底图  $MASTER"
say "  iconset  $ICONSET"
say "  应用图标  $ICNS  ($SIZE)"
say "  菜单栏模板图  $TRAY16"
say "                $TRAY32"
say ""
say "下一步：./build-app.sh 会把 app.icns 拷成 .app 的 Contents/Resources/app.icns，"
say "        把 trayTemplate*.png 拷成 Contents/Resources/app/assets/ 下（主程序读它建托盘）"
