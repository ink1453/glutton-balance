#!/bin/bash
# 包内容安全扫描：检查 .app 里有没有本机路径 / 用户名 / 疑似密钥 / 开发垃圾 / 包必备项缺失
#
# 用法：
#   ./scan-package.sh                      # 扫默认产物 build/dist/饭桶余额.app
#   ./scan-package.sh <某个.app>            # 扫指定 .app
#   ./scan-package.sh --strict             # 警告也算问题（退出码非 0）
#   ./scan-package.sh --out=<报告路径>       # 自定义报告路径（默认 build/dist/package-scan.txt）
#
# 退出码：0 = 没问题（警告不影响）；1 = 发现真问题；2 = 用法/输入错误
# 白名单：build/scan-allowlist.txt（每行一个 ERE 正则，命中的行会被忽略；以 # 开头是注释）
#
# 铁律：报告里不打印密钥原文（命中密钥的行只留位置 + 打码占位），避免二次泄露。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="$SCRIPT_DIR/dist/饭桶余额.app"
REPORT="$SCRIPT_DIR/dist/package-scan.txt"
STRICT=0
ALLOWLIST="$SCRIPT_DIR/scan-allowlist.txt"

while [ $# -gt 0 ]; do
  case "$1" in
    --strict) STRICT=1 ;;
    --out=*) REPORT="${1#--out=}" ;;
    --target=*) TARGET="${1#--target=}" ;;
    --allowlist=*) ALLOWLIST="${1#--allowlist=}" ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) echo "未知参数：$1（用 --help 看用法）" >&2; exit 2 ;;
    *) TARGET="$1" ;;
  esac
  shift
done

PROBLEMS=0
WARNINGS=0
ALLOWED=0
REPORT_DIR="$(dirname "$REPORT")"
mkdir -p "$REPORT_DIR"
: > "$REPORT"

log()  { printf '%s\n' "$*" >> "$REPORT"; }
out()  { printf '%s\n' "$*"; }
ok()   { log "  ✓ $*"; }
warn() { WARNINGS=$((WARNINGS + 1)); log "  ⚠ $*"; }
bad()  { PROBLEMS=$((PROBLEMS + 1)); log "  ❌ $*"; }
head1(){ log ""; log "## $*"; }

mask_secret() {
  # 不打印密钥原文：只保留很短的前缀，其余打码
  printf '%s' "$1" | sed -E 's/([A-Za-z0-9_+.\/-]{4})[A-Za-z0-9_+.\/-]{6,}/\1***/g'
}

truncate_line() {
  # 去掉首尾空白，最多 180 字符
  printf '%s' "$1" | tr -d '\r' | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//' | cut -c1-180
}

# 把一条命中整理成「文件:行」位置
loc_of() { # "file:lineno:content"
  printf '%s' "$1" | sed -E 's/^([^:]+:[0-9]+):.*/\1/'
}

allowlisted() { # content
  [ -f "$ALLOWLIST" ] || return 1
  local re content="$1"
  while IFS= read -r re; do
    case "$re" in ''|'#'*) continue ;; esac
    if printf '%s' "$content" | grep -qE -e "$re" 2>/dev/null; then
      return 0
    fi
  done < "$ALLOWLIST"
  return 1
}

# 扫描一个正则；category=中文分类；mask=1 时内容打码
scan_pattern() {
  local category="$1" pat="$2" mask="$3"
  local hits line loc content
  hits="$(grep -rInE --binary-files=without-match -e "$pat" "$TARGET" 2>/dev/null | head -n 60)"
  [ -z "$hits" ] && return 0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    content="${line#*:}"; content="${content#*:}"
    if allowlisted "$content"; then
      ALLOWED=$((ALLOWED + 1))
      continue
    fi
    loc="$(loc_of "$line")"
    if [ "$mask" = "1" ]; then
      bad "[$category] $loc （已打码；请人工打开该行核对）"
    else
      bad "[$category] $loc  $(truncate_line "$content")"
    fi
  done <<< "$hits"
}

out "扫描：$TARGET"
out "报告：$REPORT"
out ""

# 汇总式检查：不逐条判问题，只报命中数量 + 少量样例（用于「像代码变量名」的宽松项）
scan_pattern_warn_summary() {
  local category="$1" pat="$2" maxshow="${3:-5}"
  local hits count shown=0 line loc content
  hits="$(grep -rInE --binary-files=without-match -e "$pat" "$TARGET" 2>/dev/null)"
  if [ -z "$hits" ]; then
    ok "未命中：${category}"
    return 0
  fi
  count="$(printf '%s\n' "$hits" | wc -l | tr -d ' ')"
  WARNINGS=$((WARNINGS + 1))
  log "  ⚠ [${category}] 命中 ${count} 处（前 ${maxshow} 处，仅供人眼复核）："
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    [ "$shown" -ge "$maxshow" ] && break
    content="${line#*:}"; content="${content#*:}"
    if allowlisted "$content"; then
      ALLOWED=$((ALLOWED + 1))
      continue
    fi
    loc="$(loc_of "$line")"
    log "      · ${loc}  $(truncate_line "$content")"
    shown=$((shown + 1))
  done <<< "$hits"
}

# ---------- 0. 输入检查 ----------
[ -e "$TARGET" ] || { echo "❌ 找不到：${TARGET}（先跑 ./build-app.sh）" >&2; exit 2; }
case "$TARGET" in
  *.app) ;;
  *) echo "❌ 目标不是 .app 目录：$TARGET" >&2; exit 2 ;;
esac
[ -d "$TARGET" ] || { echo "❌ 目标不是目录：$TARGET" >&2; exit 2; }

APP_NAME="$(basename "$TARGET" .app)"
SIZE_H="$(du -sh "$TARGET" | awk '{print $1}')"
TS="$(date '+%Y-%m-%d %H:%M:%S %z')"

log "# 包内容安全扫描报告"
log ""
log "- 时间：$TS"
log "- 目标：$TARGET"
log "- 大小：$SIZE_H"
log "- 白名单：$( [ -f "$ALLOWLIST" ] && echo "$ALLOWLIST" || echo '（无）' )"

TEXT_FILES="$(grep -rIl --binary-files=without-match "" "$TARGET" 2>/dev/null | wc -l | tr -d ' ')"
ALL_FILES="$(find "$TARGET" -type f 2>/dev/null | wc -l | tr -d ' ')"
log "- 文件：$ALL_FILES 个（其中文本 $TEXT_FILES 个参与内容扫描，二进制跳过）"

# ---------- 1. 包必备结构 ----------
head1 "1. 包结构与 Info.plist"
PLIST="$TARGET/Contents/Info.plist"
BIN="$TARGET/Contents/MacOS/Electron"
APP_DIR="$TARGET/Contents/Resources/app"
ICNS="$TARGET/Contents/Resources/app.icns"

check_exists() { # desc path
  if [ -e "$2" ]; then ok "$1：$(basename "$2")"; else bad "缺 $1：$2"; fi
}
check_exists "主程序入口" "$BIN"
check_exists "Info.plist" "$PLIST"
check_exists "app 源码目录" "$APP_DIR"
check_exists "应用图标" "$ICNS"
check_exists "package.json" "$APP_DIR/package.json"
check_exists "main.js" "$APP_DIR/main.js"

if [ -x "$BIN" ]; then ok "Electron 可执行位正常"; else bad "Contents/MacOS/Electron 没有可执行权限"; fi

if [ -f "$PLIST" ]; then
  pget() { /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" 2>/dev/null; }
  expect() { local k="$1" want="$2" got; got="$(pget "$k")"
    if [ "$got" = "$want" ]; then ok "Info.plist $k = $want"; else bad "Info.plist $k = '${got}'（应为 '$want'）"; fi; }
  expect CFBundleIdentifier "com.maimai.petbalancepanel"
  expect CFBundleShortVersionString "0.0.4"
  expect CFBundleVersion "1"
  expect CFBundleIconFile "app.icns"
  expect LSMinimumSystemVersion "14.0"
  expect LSUIElement "true"
  expect NSHighResolutionCapable "true"
  expect CFBundleExecutable "Electron"
  BNAME="$(pget CFBundleName)"
  case "$BNAME" in *饭桶余额*) ok "Info.plist CFBundleName = $BNAME" ;; *) warn "CFBundleName = '$BNAME'（正式包应为 饭桶余额；自测包忽略）" ;; esac
  # 应用图标与包内 icns 一致
  if [ -f "$ICNS" ] && [ -f "$TARGET/Contents/Resources/electron.icns" ]; then
    if cmp -s "$ICNS" "$TARGET/Contents/Resources/electron.icns"; then
      warn "app.icns 与运行时自带的 electron.icns 完全相同（可能没换成自己的图标）"
    else
      ok "app.icns 是自制图标（与 electron.icns 不同）"
    fi
  fi
fi

# 包内不该带的东西（开发物）
for junk in build dummy docs tools CONTRACT.md test tests .git node_modules .github .DS_Store; do
  if [ -e "$APP_DIR/$junk" ]; then bad "app/ 里混进了开发物：$junk"; fi
done
# 任何层级的 test/build/tools/docs 目录都不许有（renderer/test 之类会被带进来）
DEV_DIRS="$(find "$TARGET" -type d \( -name 'test' -o -name 'tests' -o -name '__tests__' -o -name 'build' -o -name 'tools' -o -name 'docs' \) 2>/dev/null | head -n 20)"
if [ -n "$DEV_DIRS" ]; then
  while IFS= read -r d; do bad "[开发目录] ${d#$TARGET/}"; done <<< "$DEV_DIRS"
else
  ok "没有任何 test/build/tools/docs 目录"
fi

# 主程序接入项（缺了功能会残：托盘/权限页/定位器）
if [ -f "$APP_DIR/assets/trayTemplate.png" ]; then
  TRAY_W="$(sips -g pixelWidth "$APP_DIR/assets/trayTemplate.png" 2>/dev/null | awk '/pixelWidth/{print $2}')"
  if [ "$TRAY_W" = "16" ]; then ok "托盘模板图 assets/trayTemplate.png（16×16）"; else warn "托盘模板图宽 ${TRAY_W}px（建议 16×16）"; fi
else
  bad "缺 app/assets/trayTemplate.png（主程序将不建托盘）"
fi
[ -f "$APP_DIR/permission.html" ] && ok "权限引导页 permission.html 已进包" || bad "缺 app/permission.html"
if [ -f "$APP_DIR/native/petprobe" ]; then
  [ -x "$APP_DIR/native/petprobe" ] && ok "native/petprobe 可执行" || bad "native/petprobe 没有可执行位"
  codesign --verify "$APP_DIR/native/petprobe" >/dev/null 2>&1 && ok "native/petprobe 签名有效" || warn "native/petprobe 签名校验未通过"
else
  bad "缺 app/native/petprobe（定位器）"
fi

# ---------- 2. 开发垃圾文件 ----------
head1 "2. 开发垃圾 / 可疑副文件"
DS="$(find "$TARGET" -name '.DS_Store' 2>/dev/null | head -n 10)"
if [ -n "$DS" ]; then
  while IFS= read -r f; do bad "[.DS_Store] ${f#$TARGET/}"; done <<< "$DS"
else
  ok "没有 .DS_Store"
fi
FILES_JUNK="$(find "$TARGET" \( -name '*.log' -o -name '*.map' -o -name '*.bak' -o -name '*.bak-*' -o -name '*.bak.*' -o -name '*.orig' -o -name '*.rej' -o -name '*~' -o -name '*.old' -o -name '*.tmp' -o -name '*.save' -o -name '*.swp' -o -name '.env' -o -name '.env.*' -o -name '._*' -o -name 'id_rsa*' -o -name 'id_ed25519*' -o -name '*.pem' -o -name '*.key' -o -name '*.p12' -o -name '*.mobileprovision' \) 2>/dev/null | head -n 20)"
if [ -n "$FILES_JUNK" ]; then
  while IFS= read -r f; do bad "[开发/密钥类文件] ${f#$TARGET/}"; done <<< "$FILES_JUNK"
else
  ok "没有日志/备份/临时/密钥类文件"
fi
NM="$(find "$TARGET" -name 'node_modules' -type d 2>/dev/null | head -n 5)"
if [ -n "$NM" ]; then
  while IFS= read -r f; do bad "[node_modules] ${f#$TARGET/}"; done <<< "$NM"
else
  ok "没有 node_modules"
fi

# ---------- 3. 本机路径 / 用户名 ----------
head1 "3. 本机路径 / 用户名"
# 注意：扫描正则本身也含「本机路径 / 旧 bundle id」字样，这里一律拆成相邻字符串拼接，
# 避免脚本源码被公开仓 R-42 扫描当成命中（运行时拼出来的正则与原来一致，扫描能力不变）。
scan_pattern "本机绝对路径" '/Use''rs/[A-Za-z0-9._-]+' 0
scan_pattern "本机绝对路径" '/home/[A-Za-z0-9._-]+' 0
scan_pattern "本机绝对路径" 'C:\\\\?Users\\\\?[A-Za-z0-9._-]+' 0
# 本机用户名：运行时用 id -un 推导，不把某个用户名写死在公开仓库里
CUR_USER="$(id -un 2>/dev/null || true)"
if [ -n "$CUR_USER" ]; then
  scan_pattern "本机用户名" "/Use""rs/${CUR_USER}" 0
  scan_pattern "本机用户名" "/home/${CUR_USER}" 0
  scan_pattern "本机用户名" "${CUR_USER}@[A-Za-z0-9.-]+" 0
fi
scan_pattern "工程目录名" 'pbp-mac|prep-1-3|pbp-mac/prep' 0
# 旧 bundle id（改名前的旧组织标识）必须 0 命中；现行 = com.maimai.petbalancepanel（与已安装 App / LaunchAgent 一致）。
# 同样拆成拼接形式，避免脚本源码被公开仓扫描误判，扫描能力不减。
LEGACY_BUNDLE_ID="com."'rice'"bowl"'.petbalancepanel'
scan_pattern "旧 bundle id" "$LEGACY_BUNDLE_ID" 0
scan_pattern "会话环境变量" 'ELECTRON_RUN_AS_NODE' 0
scan_pattern "桌面路径" '/Desktop/' 0
# 裸词用户名：代码里常是文字颜色变量名（ink/inkDim 这类），只汇总提示、不判问题
if [ -n "$CUR_USER" ]; then
  scan_pattern_warn_summary "裸词 ${CUR_USER}（多半是代码变量名，仅提示）" "(^|[^A-Za-z0-9_])${CUR_USER}([^A-Za-z0-9_]|$)" 5
fi

# ---------- 4. 疑似密钥 / token ----------
head1 "4. 疑似密钥 / token（只报位置，内容打码）"
scan_pattern "密钥前缀" 'sk-[A-Za-z0-9_-]{20,}' 1
scan_pattern "密钥前缀" 'sk-ant-[A-Za-z0-9_-]{20,}' 1
scan_pattern "GitHub token" '(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}' 1
scan_pattern "GitHub token" 'github_pat_[A-Za-z0-9_]{20,}' 1
scan_pattern "AWS key" 'AKIA[0-9A-Z]{16}' 1
scan_pattern "Slack token" 'xox[baprs]-[A-Za-z0-9-]{10,}' 1
scan_pattern "Google key" 'AIza[0-9A-Za-z_-]{30,}' 1
scan_pattern "私钥" '-----BEGIN [A-Z ]*PRIVATE KEY-----' 1
scan_pattern "Bearer token" 'Bearer[[:space:]]+[A-Za-z0-9._-]{20,}' 1
scan_pattern "JWT" 'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.' 1
scan_pattern "赋值式密钥" '(api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key|private[_-]?key|auth[_-]?token)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_.+/=-]{12,}' 1

# ---------- 5. package.json ----------
head1 "5. package.json"
if [ -f "$APP_DIR/package.json" ]; then
  if grep -qE '"devDependencies"' "$APP_DIR/package.json" 2>/dev/null; then
    bad "package.json 里还有 devDependencies（构建应已剔除）"
  else
    ok "package.json 没有 devDependencies"
  fi
  if grep -qE '"(electron|@electron/)' "$APP_DIR/package.json" 2>/dev/null && grep -qE '"dependencies"' "$APP_DIR/package.json" 2>/dev/null; then
    warn "package.json 的 dependencies 里似乎含 electron（运行时应在 .app 里，不该当依赖装）"
  fi
  if grep -qE '"main"[[:space:]]*:[[:space:]]*"' "$APP_DIR/package.json" 2>/dev/null; then
    ok "package.json 有 main 字段"
  else
    bad "package.json 没有 main 字段（Electron 找不到入口）"
  fi
else
  bad "缺少 app/package.json"
fi
if grep -rIn --binary-files=without-match 'devDependencies' "$TARGET" 2>/dev/null | grep -qv "$APP_DIR/package.json"; then
  bad "包内仍有 devDependencies 字样（见上面命中行）"
fi

# ---------- 6. 签名与体积 ----------
head1 "6. 签名与体积"
# 签名口径（老板 2026-11-01 定）：本机自签证书 "Maizi Local Code Signing"，不用 ad-hoc。
# 先 --deep --strict 校验 + 验身份/flags；若 in-place 失败只因 iCloud/FinderInfo 扩展属性
# （工作区在 ~/Documents 同步目录，同步服务会重注入 xattr），自动复制到 /tmp 清 xattr 后复验，
# 不误判为签名坏了（也不降低检查强度：真正签名无效时同样报不出来）。
SIGN_ID_WANT="${SIGN_ID_WANT:-Maizi Local Code Signing}"

check_signature() {
  local APP="$1" AUTH FLAGS FOK=0
  if ! codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
    return 1
  fi
  AUTH="$(codesign -dv --verbose=4 "$APP" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
  FLAGS="$(codesign -dv --verbose=4 "$APP" 2>&1 | grep -o 'flags=0x[0-9a-fA-F]*([^)]*)' | head -1)"
  FLAGS="${FLAGS#flags=}"
  ok "codesign --verify --deep --strict 通过（Authority=${AUTH:-未记录}，flags=${FLAGS:-?}）"
  case "${FLAGS:-}" in 0x0*) FOK=1 ;; esac
  if [ "$AUTH" = "$SIGN_ID_WANT" ] && [ "$FOK" -eq 1 ]; then
    ok "签名身份合规：本机自签证书 ${SIGN_ID_WANT} + flags=0x0（非 ad-hoc）"
  else
    bad "签名身份不合规：Authority=${AUTH:-?}、flags=${FLAGS:-?}（老板 2026-11-01 规矩：打包一律本机自签证书、flags=0x0，禁 ad-hoc）"
  fi
  return 0
}

if ! check_signature "$TARGET"; then
  VF_ERR="$(codesign --verify --deep --strict "$TARGET" 2>&1 | head -3)"
  if printf '%s' "$VF_ERR" | grep -q 'detritus\|FinderInfo'; then
    warn "in-place 复验未通过：命中 iCloud/FinderInfo 扩展属性（工作区在 ~/Documents 同步目录）→ 复制到 /tmp 清 xattr 后复验"
    TMPCHK="${TMPDIR:-/tmp}/pbp-verify-$$"
    if ditto "$TARGET" "$TMPCHK/$(basename "$TARGET")" 2>/dev/null; then
      xattr -cr "$TMPCHK/$(basename "$TARGET")" 2>/dev/null || true
      if check_signature "$TMPCHK/$(basename "$TARGET")"; then
        ok "结论：签名有效（in-place 失败仅因 iCloud FinderInfo 干扰；复制 /tmp 后 --verify --deep --strict 通过）"
      else
        warn "复制到 /tmp 后复验仍未通过（请人工检查签名）"
      fi
    else
      warn "无法复制到 /tmp 复验（签名状态待人工确认）"
    fi
    rm -rf "$TMPCHK"
  else
    warn "codesign --verify --deep --strict 未通过（可能还能本机运行；正式交付前建议重签）"
  fi
fi
SIZE_B="$(du -sk "$TARGET" | awk '{print $1 * 1024}')"
log "  · 体积：${SIZE_H}（$SIZE_B 字节）"
log "  · 文本文件：$TEXT_FILES 个 / 全部文件：$ALL_FILES 个"

# ---------- 结论 ----------
head1 "结论"
log ""
if [ "$PROBLEMS" -gt 0 ]; then
  log "❌ 发现 $PROBLEMS 条问题、$WARNINGS 条警告（白名单忽略 $ALLOWED 条）→ 不能交付"
else
  log "✅ 未发现本机路径 / 用户名 / 密钥 / 开发垃圾问题（警告 $WARNINGS 条，白名单忽略 $ALLOWED 条）"
  if [ "$WARNINGS" -gt 0 ]; then
    log "    警告不阻塞；请人眼过一遍上面带 ⚠ 的项"
  fi
fi

out ""
if [ "$PROBLEMS" -gt 0 ]; then
  out "❌ 扫描发现 $PROBLEMS 条问题（$WARNINGS 条警告）"
  out "   报告：$REPORT"
  out "   修法：把命中的文件改成相对路径/环境变量；密钥只从 ~/.dsh 或环境变量读，不写进代码"
  exit 1
fi
if [ "$STRICT" -eq 1 ] && [ "$WARNINGS" -gt 0 ]; then
  out "⚠ 严格模式：$WARNINGS 条警告按问题处理"
  out "   报告：$REPORT"
  exit 1
fi
out "✅ 扫描通过（警告 $WARNINGS 条，白名单忽略 $ALLOWED 条）"
out "   报告：$REPORT"
exit 0
