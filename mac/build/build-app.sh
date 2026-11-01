#!/bin/bash
# 把 Electron 运行时 + 本工程 app 源码打成可双击运行的 `饭桶余额.app`（ad-hoc 签名，未公证）
#
# 产物：build/dist/饭桶余额.app
# 结构：Contents/
#         MacOS/Electron                     ← 来自 mac/tools/Electron.app（Electron 38.8.6, arm64）
#         Frameworks/…                       ← Electron 运行时原样
#         Resources/app/                     ← main.js preload.js src/ renderer/ assets/ native/ package.json
#         Resources/app.icns                 ← build/icon/app.icns
#         Info.plist                         ← 改成 饭桶余额 / com.ricebowl.petbalancepanel / LSUIElement …
#
# 用法：
#   ./build-app.sh                      # 正式包（源码 = 工程根目录）
#   ./build-app.sh --with-scan          # 打完顺便跑 scan-package.sh
#   ./build-app.sh --dummy              # 打包链路自测（源码 = build/dummy，产物 = build/dist/打包链路自测.app）
#   ./build-app.sh --src=<目录> --out=<路径>    # 自定义（自测/调试用）
#
# 依赖：macOS 自带 bash/ditto/codesign/PlistBuddy；jq 可选（没有则用 build/runtime-package.json 兜底）。
# 不装 brew、不装 npm 依赖、不下载：Electron 运行时用本机已有的
#   mac/tools/Electron.app（自动查找；也可用 --electron-src= 或 ELECTRON_SRC 指定）
# 注意：启动 Electron 必须 `env -u ELECTRON_RUN_AS_NODE`（DSH 会话环境带该变量）。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Electron 运行时找法：--electron-src= / ELECTRON_SRC 环境变量 → $PROJECT_ROOT/tools/Electron.app
# 运行时体积大、不进仓；请自行下载 Electron 38.8.6 (arm64) 的 Electron.app 放到 mac/tools/Electron.app。
if [ -z "${ELECTRON_SRC:-}" ]; then
  cand="$PROJECT_ROOT/tools/Electron.app"
  if [ -x "$cand/Contents/MacOS/Electron" ]; then
    ELECTRON_SRC="$cand"
  fi
fi
ELECTRON_SRC="${ELECTRON_SRC:-$PROJECT_ROOT/tools/Electron.app}"
APP_SRC="${APP_SRC:-$PROJECT_ROOT}"
OUT="${OUT:-$BUILD_DIR/dist/饭桶余额.app}"
APP_NAME="饭桶余额"
WITH_SCAN=0
DUMMY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dummy) DUMMY=1 ;;
    --with-scan) WITH_SCAN=1 ;;
    --src=*) APP_SRC="${1#--src=}" ;;
    --out=*) OUT="${1#--out=}" ;;
    --electron-src=*) ELECTRON_SRC="${1#--electron-src=}" ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "未知参数：$1（用 --help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

if [ "$DUMMY" -eq 1 ]; then
  APP_SRC="$BUILD_DIR/dummy"
  [ "$OUT" = "$BUILD_DIR/dist/饭桶余额.app" ] && OUT="$BUILD_DIR/dist/打包链路自测.app"
  APP_NAME="打包链路自测"
fi

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf '\n❌ %s\n' "$*" >&2; exit 1; }

# ---------- 0. 前置检查 ----------
step "0/6 检查输入"

[ -x "$ELECTRON_SRC/Contents/MacOS/Electron" ] || die "找不到 Electron 运行时：$ELECTRON_SRC/Contents/MacOS/Electron
  请下载 Electron 38.8.6 (arm64) 的 Electron.app 放到 mac/tools/Electron.app，或用 --electron-src=<路径> 指定"
ok "Electron 运行时：$ELECTRON_SRC"

[ -f "$APP_SRC/package.json" ] || die "缺少 $APP_SRC/package.json（Electron 靠它找 main）"
[ -f "$APP_SRC/main.js" ] || die "缺少 $APP_SRC/main.js（主程序还没就绪？自测请用 ./build-app.sh --dummy）"
ok "app 源码：$APP_SRC"

for f in preload.js; do
  [ -f "$APP_SRC/$f" ] || warn "缺少 $APP_SRC/${f}（继续打包，但请确认主程序不需要）"
done
grep -q '"main"' "$APP_SRC/package.json" || warn "package.json 里没有 \"main\" 字段，Electron 会退回找 index.js"
command -v ditto >/dev/null 2>&1 || die "缺少 ditto（macOS 自带，不该缺）"
command -v codesign >/dev/null 2>&1 || die "缺少 codesign（macOS 自带，不该缺）"
command -v /usr/libexec/PlistBuddy >/dev/null 2>&1 || die "缺少 PlistBuddy（macOS 自带，不该缺）"

ELECTRON_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$ELECTRON_SRC/Contents/Info.plist" 2>/dev/null || echo '?')"
ok "Electron 版本：$ELECTRON_VER"

# ---------- 1. 图标 ----------
step "1/6 准备应用图标"
ICON_SRC="$BUILD_DIR/icon/app.icns"
ICON_MASTER="$BUILD_DIR/icon/icon-1024.png"
if [ ! -f "$ICON_SRC" ]; then
  say "  图标还没有，先生成（build/icon/make-icon.sh）"
  "$BUILD_DIR/icon/make-icon.sh" || die "图标生成失败（见上面的报错）"
fi
[ -f "$ICON_SRC" ] || die "图标仍不存在：$ICON_SRC"
ok "图标：${ICON_SRC}（$(du -h "$ICON_SRC" | awk '{print $1}')）"

# ---------- 2. 复制 Electron 运行时 ----------
step "2/6 复制 Electron 运行时 → $OUT"
if pgrep -f "$OUT/Contents/MacOS/Electron" >/dev/null 2>&1; then
  warn "检测到目标 app 正在运行，先结束旧实例（不弹框、不阻塞）"
  pkill -f "$OUT/Contents/MacOS/Electron" >/dev/null 2>&1 || true
  sleep 1
fi
rm -rf "$OUT"
mkdir -p "$(dirname "$OUT")"
ditto "$ELECTRON_SRC" "$OUT" || die "复制 Electron 运行时失败"
ok "运行时已复制（$(du -sh "$OUT" | awk '{print $1}')）"

# ---------- 3. 注入 app 源码 ----------
step "3/6 注入 app 源码 → Contents/Resources/app/"
RES="$OUT/Contents/Resources"
rm -rf "$RES/app" "$RES/app.asar"
mkdir -p "$RES/app"

# 进包清单（严格按主程序需要；test/ build/ tools/ docs/ 一律不进）
injected=""
for item in main.js preload.js permission.html src renderer assets native; do
  if [ -e "$APP_SRC/$item" ]; then
    ditto "$APP_SRC/$item" "$RES/app/$item" || die "注入 $item 失败"
    injected="$injected $item"
  else
    warn "缺少 $APP_SRC/${item}（未进包，请确认主程序不需要）"
  fi
done
ok "已注入：$injected"

# 开发期目录/测试工具全部剔除（主程序不需要，扫描也不许有）
for junk in build tools docs test tests node_modules .git .github .DS_Store; do
  rm -rf "$RES/app/$junk" 2>/dev/null || true
done
find "$RES/app" -type d \( -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'node_modules' \) \
  -prune -exec rm -rf {} + 2>/dev/null || true
find "$RES/app" -name '.DS_Store' -delete 2>/dev/null || true
find "$RES/app" \( -name '*.log' -o -name '*.map' -o -name '*.swp' -o -name '._*' \) -delete 2>/dev/null || true
# 待办 D2（QA §8-1）：开发期备份/临时副文件一律不进包（src/layout.js.bak-pre-*、*.orig、*~ 之类）
find "$RES/app" \( -name '*.bak' -o -name '*.bak-*' -o -name '*.bak.*' -o -name '*.orig' -o -name '*.rej' \
  -o -name '*~' -o -name '*.old' -o -name '*.tmp' -o -name '*.save' \) -delete 2>/dev/null || true
ok "已剔除开发目录（test/build/tools/docs）与 .DS_Store / node_modules / 备份临时文件（*.bak* 等）"
# D2 防回归：剔除后再确认一遍，包内出现备份/临时文件直接失败（避免再夹带 .bak 进包）
BAK_LEFT="$(find "$RES/app" \( -name '*.bak' -o -name '*.bak-*' -o -name '*.bak.*' -o -name '*.orig' -o -name '*.rej' \
  -o -name '*~' -o -name '*.old' -o -name '*.tmp' -o -name '*.save' \) 2>/dev/null | head -n 10)"
if [ -n "$BAK_LEFT" ]; then
  die "包内仍有备份/临时文件（待办 D2 约束）：$(printf '%s' "$BAK_LEFT" | tr '\n' ' ')"
fi
ok "备份/临时文件核对：0 个（*.bak* / *.orig / *~ / *.tmp 等）"

# package.json：进包副本去掉开发字段与 dev 脚本（package.json 的 scripts 里带 env -u ELECTRON_RUN_AS_NODE）
if command -v jq >/dev/null 2>&1; then
  jq 'del(.devDependencies, .optionalDependencies, .peerDependencies, .scripts) | .private = true' \
    "$APP_SRC/package.json" > "$RES/app/package.json" || die "package.json 处理失败（jq）"
  ok "package.json 已精简：去掉 devDependencies / optionalDependencies / peerDependencies / scripts"
elif [ -f "$BUILD_DIR/runtime-package.json" ]; then
  cp "$BUILD_DIR/runtime-package.json" "$RES/app/package.json" || die "复制 build/runtime-package.json 失败"
  warn "本机没有 jq：使用预生成的 build/runtime-package.json（若改过 mac/package.json，请同步更新它）"
else
  die "本机没有 jq 且缺 build/runtime-package.json：请安装 jq（如 brew install jq）或恢复该文件"
fi

# 菜单栏模板图（主程序读 app/assets/trayTemplate.png，缺了就不建托盘）
TRAY_SRC="$BUILD_DIR/icon/tray"
if [ -f "$TRAY_SRC/trayTemplate.png" ]; then
  mkdir -p "$RES/app/assets"
  cp "$TRAY_SRC/trayTemplate.png" "$RES/app/assets/trayTemplate.png"
  [ -f "$TRAY_SRC/trayTemplate@2x.png" ] && cp "$TRAY_SRC/trayTemplate@2x.png" "$RES/app/assets/trayTemplate@2x.png"
  ok "托盘模板图已进包：assets/trayTemplate.png（+@2x）"
else
  warn "缺 build/icon/tray/trayTemplate.png，先跑 build/icon/make-icon.sh（主程序将不建托盘）"
fi

# native/petprobe 必须有可执行位（否则定位器起不来）
PETPROBE_BIN="$RES/app/native/petprobe"
if [ "$DUMMY" -eq 1 ]; then
  :  # 自测包没有 native/，跳过
elif [ -f "$PETPROBE_BIN" ]; then
  [ -x "$PETPROBE_BIN" ] || { chmod +x "$PETPROBE_BIN"; warn "native/petprobe 没有可执行位，已补上"; }
  file "$PETPROBE_BIN" | grep -q 'Mach-O' || die "native/petprobe 不是 Mach-O 可执行文件（重新编译？）"
  ok "native/petprobe 可执行（$(file -b "$PETPROBE_BIN" | cut -c1-40)…）"
else
  die "缺 app/native/petprobe（定位器必需；找不到主程序无法跟随桌宠）"
fi

# 关键进包项核对
if [ "$DUMMY" -eq 1 ]; then
  REQUIRED="package.json main.js preload.js renderer/index.html"
else
  REQUIRED="package.json main.js preload.js permission.html renderer/index.html native/petprobe"
fi
for f in $REQUIRED; do
  [ -e "$RES/app/$f" ] || die "进包缺文件：$f"
done
ok "关键文件齐全（${REQUIRED}）"

# ---------- 4. 放图标 + 改 Info.plist ----------
step "4/6 改 Info.plist（名字 / bundle id / LSUIElement / 版本 / 图标）"
cp "$ICON_SRC" "$RES/app.icns" || die "复制 app.icns 失败"
ok "Contents/Resources/app.icns"

PLIST="$OUT/Contents/Info.plist"
[ -f "$PLIST" ] || die "运行时里没有 Info.plist：$PLIST"

plist_str() {
  local key="$1" val="$2"
  if /usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$key $val" "$PLIST" || die "改 Info.plist 失败：$key"
  else
    /usr/libexec/PlistBuddy -c "Add :$key string $val" "$PLIST" || die "加 Info.plist 失败：$key"
  fi
}
plist_bool() {
  local key="$1" val="$2"
  if /usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$key $val" "$PLIST" || die "改 Info.plist 失败：$key"
  else
    /usr/libexec/PlistBuddy -c "Add :$key bool $val" "$PLIST" || die "加 Info.plist 失败：$key"
  fi
}

plist_str  CFBundleName             "$APP_NAME"
plist_str  CFBundleDisplayName      "$APP_NAME"
plist_str  CFBundleIdentifier       "com.ricebowl.petbalancepanel"
plist_str  CFBundleExecutable       "Electron"
plist_str  CFBundleShortVersionString "0.1.0"
plist_str  CFBundleVersion          "1"
plist_str  CFBundleIconFile         "app.icns"
plist_str  LSMinimumSystemVersion   "14.0"
plist_str  LSApplicationCategoryType "public.app-category.utilities"
plist_bool LSUIElement              true
plist_bool NSHighResolutionCapable  true

# 校验关键字段真的写进去了
check_plist() {
  local key="$1" want="$2" got
  got="$(/usr/libexec/PlistBuddy -c "Print :$key" "$PLIST" 2>/dev/null)"
  [ "$got" = "$want" ] || die "Info.plist 校验失败：$key=${got}（期望 ${want}）"
}
check_plist CFBundleName "$APP_NAME"
check_plist CFBundleIdentifier "com.ricebowl.petbalancepanel"
check_plist CFBundleShortVersionString "0.1.0"
check_plist CFBundleVersion "1"
check_plist CFBundleIconFile "app.icns"
check_plist LSMinimumSystemVersion "14.0"
check_plist LSUIElement "true"
check_plist NSHighResolutionCapable "true"
ok "Info.plist 关键字段全部核对通过"

# 清隔离属性（本地构建一般没有；有也不让 Gatekeeper 拦）
xattr -dr com.apple.quarantine "$OUT" 2>/dev/null || true
find "$OUT" -name '.DS_Store' -delete 2>/dev/null || true

# ---------- 5. ad-hoc 签名 ----------
step "5/6 ad-hoc 签名（原生 petprobe + 整个 .app）"
# 先单独签 native/petprobe（Contents/Resources 里的独立可执行文件，--deep 不保证覆盖）
PETPROBE_BIN="$RES/app/native/petprobe"
if [ -f "$PETPROBE_BIN" ]; then
  if codesign --force -s - "$PETPROBE_BIN" >/dev/null 2>&1; then
    ok "native/petprobe 已单独 ad-hoc 签名"
  else
    warn "native/petprobe 单独签名失败（继续签整个 app；--deep 可能补签）"
  fi
fi
say "  250MB 左右，通常 10–40 秒…"
if ! codesign --force --deep -s - "$OUT" 2>&1 | sed 's/^/    /'; then
  die "codesign 签名失败"
fi
if [ -f "$PETPROBE_BIN" ]; then
  codesign --verify "$PETPROBE_BIN" >/dev/null 2>&1 || warn "native/petprobe 签名校验未通过"
fi
SIGN_OK="no"
if codesign --verify --verbose=2 "$OUT" >/dev/null 2>&1; then
  SIGN_OK="yes"
  ok "签名校验通过（ad-hoc，本机可用；拷到别人机器会被 Gatekeeper 拦）"
else
  warn "签名校验未通过（可能仍能本机运行；请检查上面的 codesign 输出）"
fi
codesign -dv "$OUT" 2>&1 | sed 's/^/    /' | head -8

# ---------- 6. 产物信息 ----------
step "6/6 产物"
[ -d "$OUT" ] || die "打包失败：$OUT 不存在"
SIZE_H="$(du -sh "$OUT" | awk '{print $1}')"
SIZE_B="$(du -sk "$OUT" | awk '{print $1 * 1024}')"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$PLIST")"
APP_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST")"

# 构建记录（便于事后核对；放在 dist/ 里，不进包）
REPORT="$BUILD_DIR/dist/build-report.txt"
{
  echo "# 饭桶余额 构建记录"
  echo "时间:        $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "产物:        $OUT"
  echo "大小:        ${SIZE_H}（$SIZE_B 字节）"
  echo "bundle id:   $BUNDLE_ID"
  echo "版本:        $APP_VER (build $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$PLIST"))"
  echo "Electron:    ${ELECTRON_VER}（来自 ${ELECTRON_SRC}）"
  echo "app 源码:    $APP_SRC"
  echo "注入内容:   main.js preload.js permission.html src/ renderer/ assets/ native/ package.json（已去 dev 字段/scripts）"
  echo "             assets/trayTemplate.png + @2x（托盘模板图）"
  echo "图标:        $ICON_SRC"
  echo "签名:        ad-hoc (codesign --force --deep -s -)，verify=$SIGN_OK"
  echo "Info.plist sha256: $(shasum -a 256 "$PLIST" | awk '{print $1}')"
} > "$REPORT"
ok "构建记录：$REPORT"

say ""
say "✅ 打包完成"
say "   产物：$OUT"
say "   大小：${SIZE_H}（$SIZE_B 字节）"
say "   标识：$BUNDLE_ID  版本：$APP_VER  Electron：$ELECTRON_VER"
say ""
say "   手动启动（DSH 会话里必须带 env -u ELECTRON_RUN_AS_NODE）："
say "     env -u ELECTRON_RUN_AS_NODE \"$OUT/Contents/MacOS/Electron\""
say "   或者：open \"$OUT\""
say "   装到 ~/Applications 并设登录自启：./install.sh"
say "   包内容安全扫描：./scan-package.sh"

if [ "$WITH_SCAN" -eq 1 ]; then
  "$BUILD_DIR/scan-package.sh" "$OUT" || die "包内容扫描发现问题（见 build/dist/package-scan.txt）"
fi
