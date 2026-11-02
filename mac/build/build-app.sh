#!/bin/bash
# 把 Electron 运行时 + 本工程 app 源码打成可双击运行的 `饭桶余额.app`
# （签名 = 本机自签证书 "Maizi Local Code Signing"，未公证；不再用 ad-hoc——见第 5 步与 README「签名」段）
#
# 产物：build/dist/饭桶余额.app
# 结构：Contents/
#         MacOS/Electron                     ← 来自 mac/tools/Electron.app（Electron 38.8.6, arm64）
#         Frameworks/…                       ← Electron 运行时原样
#         Resources/app/                     ← main.js preload.js src/ renderer/ assets/ native/ package.json
#         Resources/app.icns                 ← build/icon/app.icns
#         Info.plist                         ← 改成 饭桶余额 / com.gluttonbalance.panel / LSUIElement …
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
# 发布版本：与 app-mac/package.json / repo/mac/package.json 保持同号（发布新版改这一处）
APP_VERSION="0.0.4"
# bundle id：必须与已安装 App / LaunchAgent / 文档一致（2026-11-02 改名定稿：glutton-balance）
APP_BUNDLE_ID="com.gluttonbalance.panel"
# 签名身份：老板 2026-11-01 定的硬规矩——打包/重签一律用本机自签证书，不再用 ad-hoc（-）
# （ad-hoc 只按 cdhash 认身份，每次重打包 TCC 录屏授权就失效、死循环；对外分发换 Developer ID + 公证）
# 换机器/公开源码自建时可用环境变量覆盖：SIGN_IDENTITY="你的证书名" ./build-app.sh
SIGN_IDENTITY="${SIGN_IDENTITY:-Maizi Local Code Signing}"
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

# ---------- 构建暂存目录（必须非 iCloud 同步目录）----------
# 本工作区在 ~/Documents（iCloud 同步）：同步服务会持续给包内文件重新注入 FinderInfo /
# FileProvider 扩展属性，导致 codesign 在签名/复验时随机报「resource fork, Finder information…」。
# 所以「构建 + 签名 + --verify --deep --strict 硬校验」统一在 $TMPDIR 暂存目录完成，
# 最后再 ditto 交付到 build/dist（交付路径保留给 --out / 默认 dist）。
OUT_FINAL="$OUT"
STAGE="${PB_BUILD_STAGE:-${TMPDIR:-/tmp}/pbp-build-$$}"
mkdir -p "$STAGE" || die "无法创建构建暂存目录：$STAGE"
OUT="$STAGE/$(basename "$OUT_FINAL")"
trap 'rm -rf "$STAGE"' EXIT

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
plist_str  CFBundleIdentifier       "$APP_BUNDLE_ID"
plist_str  CFBundleExecutable       "Electron"
plist_str  CFBundleShortVersionString "$APP_VERSION"
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
check_plist CFBundleIdentifier "$APP_BUNDLE_ID"
check_plist CFBundleShortVersionString "$APP_VERSION"
check_plist CFBundleVersion "1"
check_plist CFBundleIconFile "app.icns"
check_plist LSMinimumSystemVersion "14.0"
check_plist LSUIElement "true"
check_plist NSHighResolutionCapable "true"
ok "Info.plist 关键字段全部核对通过"

# 清扩展属性：隔离属性（quarantine）+ FinderInfo / 文件提供器（iCloud 同步）等杂项；
# 否则 codesign 会报「resource fork, Finder information, or similar detritus not allowed」
xattr -cr "$OUT" 2>/dev/null || true
find "$OUT" -name '.DS_Store' -delete 2>/dev/null || true

# ---------- 5. 本机自签证书签名 ----------
step "5/6 本机自签证书签名（native/petprobe + 整个 .app）"
# 规矩（老板 2026-11-01 定）：打包/重签一律用本机自签证书 "$SIGN_IDENTITY"，不再用 ad-hoc（-）。
# 原因：ad-hoc 只按 cdhash 认身份，每次重打包 TCC（屏幕录制）授权就失效、死循环；本机证书按
# 「证书 + Bundle ID」认身份，重新打包不再换身份。对外分发换 Developer ID + 公证。
# 前置：证书必须存在——缺证书就明确失败，绝不静默退回 ad-hoc。
if ! security find-identity -v -p codesigning 2>/dev/null | grep -Fq "\"$SIGN_IDENTITY\""; then
  die "找不到本机自签证书 \"$SIGN_IDENTITY\"（用 security find-identity -v -p codesigning 查看）。
  缺证书时不允许退回 ad-hoc（ad-hoc 每次重打包 TCC 授权都会失效，老板 2026-11-01 硬规矩）。
  恢复：钥匙串访问里导入/重新生成同名自签证书后再打包。"
fi
ok "签名身份已就绪：$SIGN_IDENTITY"

# 先单独签 native/petprobe（Contents/Resources 里的独立可执行文件，--deep 不保证覆盖）
# 注：本工作区在 ~/Documents（iCloud 同步）下，Finder/FileProvider 会不断把 FinderInfo
#    等扩展属性加回来；codesign 见到这些「detritus」会报错，所以每次签名前都先清一次。
PETPROBE_BIN="$RES/app/native/petprobe"
if [ -f "$PETPROBE_BIN" ]; then
  xattr -c "$PETPROBE_BIN" 2>/dev/null || true
  if codesign --force --sign "$SIGN_IDENTITY" "$PETPROBE_BIN" 2>&1 | sed 's/^/    /'; then
    ok "native/petprobe 已单独用本机证书签名"
  else
    die "native/petprobe 签名失败（证书 \"$SIGN_IDENTITY\"）"
  fi
fi

# 签整个 .app（--deep）。iCloud 同步服务会在清完后很快把 xattr 加回来，所以「签名前清 + 重试」；
# 若 --deep 仍报错，按 fact 记录先补签 Electron Framework，再签 App 本体。
say "  250MB 左右，通常 10–40 秒…"
signed=0
for attempt in 1 2 3; do
  xattr -cr "$OUT" 2>/dev/null || true
  if codesign --force --deep --sign "$SIGN_IDENTITY" "$OUT" 2>&1 | sed 's/^/    /'; then
    signed=1
    ok "整个 .app 已用本机证书签名（第 ${attempt} 次尝试）"
    break
  fi
  warn "第 ${attempt} 次 --deep 签名失败（若报 detritus：iCloud/FinderInfo 扩展属性被同步服务加回，清掉重试）"
  sleep 1
done
if [ "$signed" -ne 1 ]; then
  warn "--deep 仍失败：按 fact 记录先单独补签 Electron Framework，再签 App 本体"
  EW_FW="$OUT/Contents/Frameworks/Electron Framework.framework"
  [ -e "$EW_FW" ] || die "签名失败，且找不到内层 $EW_FW"
  xattr -cr "$EW_FW" 2>/dev/null || true
  codesign --force --sign "$SIGN_IDENTITY" "$EW_FW" 2>&1 | sed 's/^/    /' || die "补签 Electron Framework 失败（证书 \"$SIGN_IDENTITY\"）"
  ok "Electron Framework 已用本机证书补签"
  xattr -cr "$OUT" 2>/dev/null || true
  codesign --force --deep --sign "$SIGN_IDENTITY" "$OUT" 2>&1 | sed 's/^/    /' || die "codesign 签名失败（补签 Electron Framework 后仍失败）"
  ok "整个 .app 已用本机证书签名（补签 Framework 后）"
fi

# ---------- 5.1 签名硬校验（不满足就拒绝出包） ----------
SIGN_OK="no"
if ! codesign --verify --deep --strict "$OUT" >/dev/null 2>&1; then
  die "签名硬校验失败：codesign --verify --deep --strict 退出码非 0（不允许出包）"
fi
SIGN_OK="yes"
ok "codesign --verify --deep --strict 通过（退出码 0）"

if [ -f "$PETPROBE_BIN" ]; then
  codesign --verify --strict "$PETPROBE_BIN" >/dev/null 2>&1 || die "native/petprobe 严格校验失败"
  ok "native/petprobe 严格校验通过"
fi

# 身份与 flags 硬校验：必须是本机自签证书、flags=0x0（不是 ad-hoc 的 0x2）
SIGN_DV="$(codesign -dv --verbose=4 "$OUT" 2>&1 || true)"
printf '%s\n' "$SIGN_DV" | sed 's/^/    /' | head -12
if ! printf '%s\n' "$SIGN_DV" | grep -Fq "Authority=$SIGN_IDENTITY"; then
  die "签名身份不是 \"$SIGN_IDENTITY\"（codesign -dv 见上；ad-hoc 出包被禁止）"
fi
# codesign -dv 的 flags 在「CodeDirectory v=… flags=0x0(none) …」这一行里（不是独立行），用 grep -o 取
SIGN_FLAGS="$(printf '%s\n' "$SIGN_DV" | grep -o 'flags=0x[0-9a-fA-F]*([^)]*)' | head -1)"
SIGN_FLAGS="${SIGN_FLAGS#flags=}"
case "$SIGN_FLAGS" in
  0x0*) : ;;
  *) die "签名 flags 不是 0x0（实际 flags=${SIGN_FLAGS}；codesign -dv 见上）" ;;
esac
SIGN_AUTHORITY="$SIGN_IDENTITY"
SIGN_CDHASH="$(printf '%s\n' "$SIGN_DV" | grep -o 'CDHash=[0-9a-fA-F]*' | head -1)"
SIGN_CDHASH="${SIGN_CDHASH#CDHash=}"
ok "签名身份 = ${SIGN_AUTHORITY}，flags=${SIGN_FLAGS}，CDHash=${SIGN_CDHASH}"

# ---------- 6. 交付产物 ----------
step "6/6 交付产物 → $OUT_FINAL"
[ -d "$OUT" ] || die "打包失败：$OUT 不存在"
mkdir -p "$(dirname "$OUT_FINAL")" || die "无法创建交付目录：$(dirname "$OUT_FINAL")"
rm -rf "$OUT_FINAL"
# 交付前清一次扩展属性；交付后用 ditto 保持签名不变（签名已在暂存目录硬校验通过）
xattr -cr "$OUT" 2>/dev/null || true
ditto "$OUT" "$OUT_FINAL" || die "复制产物失败：$OUT → $OUT_FINAL"
xattr -cr "$OUT_FINAL" 2>/dev/null || true
ok "产物已交付：$OUT_FINAL"
if codesign --verify --deep --strict "$OUT_FINAL" >/dev/null 2>&1; then
  ok "交付产物 in-place 复验通过（--verify --deep --strict 退出码 0）"
else
  warn "交付产物在 iCloud 同步目录内，同步服务重新注入 FinderInfo 后 in-place 复验可能报 detritus（签名本身已在暂存目录硬校验通过）；复验方法见 README：复制到 /tmp 后 codesign --verify --deep --strict"
fi
SIZE_H="$(du -sh "$OUT_FINAL" | awk '{print $1}')"
SIZE_B="$(du -sk "$OUT_FINAL" | awk '{print $1 * 1024}')"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$OUT/Contents/Info.plist")"
APP_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$OUT/Contents/Info.plist")"

# 构建记录（便于事后核对；放在 dist/ 里，不进包）
REPORT="$BUILD_DIR/dist/build-report.txt"
{
  echo "# 饭桶余额 构建记录"
  echo "时间:        $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "产物:        $OUT_FINAL"
  echo "大小:        ${SIZE_H}（$SIZE_B 字节）"
  echo "bundle id:   $BUNDLE_ID"
  echo "版本:        $APP_VER (build $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$OUT/Contents/Info.plist"))"
  echo "Electron:    ${ELECTRON_VER}（来自 ${ELECTRON_SRC}）"
  echo "app 源码:    $APP_SRC"
  echo "注入内容:   main.js preload.js permission.html src/ renderer/ assets/ native/ package.json（已去 dev 字段/scripts）"
  echo "             assets/trayTemplate.png + @2x（托盘模板图）"
  echo "图标:        $ICON_SRC"
  echo "签名:        本机自签证书 \"$SIGN_AUTHORITY\"（codesign --force --deep --sign），verify --deep --strict=ok"
  echo "签名 flags:  ${SIGN_FLAGS}（0x0=非 ad-hoc）；Authority=${SIGN_AUTHORITY}；CDHash=${SIGN_CDHASH}"
  echo "签名口径:    老板 2026-11-01 定：打包/重签一律本机自签证书，不用 ad-hoc；对外分发换 Developer ID + 公证"
  echo "硬校验目录:  ${OUT}（非 iCloud 暂存目录）；交付: ditto → ${OUT_FINAL}（签名不变）"
  echo "iCloud 说明: 工作区在 ~/Documents 下，同步服务会给交付目录内文件重新注入 FinderInfo（xattr），"
  echo "             故 in-place 复验可能报 detritus；签名有效性以暂存目录 --verify --deep --strict=ok 为准。"
  echo "Info.plist sha256: $(shasum -a 256 "$PLIST" | awk '{print $1}')"
} > "$REPORT"
ok "构建记录：$REPORT"

say ""
say "✅ 打包完成"
say "   产物：$OUT_FINAL"
say "   大小：${SIZE_H}（$SIZE_B 字节）"
say "   标识：$BUNDLE_ID  版本：$APP_VER  Electron：$ELECTRON_VER"
say "   签名：${SIGN_AUTHORITY}（flags=${SIGN_FLAGS}，CDHash=${SIGN_CDHASH}）"
say ""
say "   手动启动（DSH 会话里必须带 env -u ELECTRON_RUN_AS_NODE）："
say "     env -u ELECTRON_RUN_AS_NODE \"$OUT_FINAL/Contents/MacOS/Electron\""
say "   或者：open \"$OUT_FINAL\""
say "   装到 ~/Applications 并设登录自启：./install.sh"
say "   包内容安全扫描：./scan-package.sh"

if [ "$WITH_SCAN" -eq 1 ]; then
  "$BUILD_DIR/scan-package.sh" "$OUT_FINAL" || die "包内容扫描发现问题（见 build/dist/package-scan.txt）"
fi
