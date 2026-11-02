#!/bin/bash
# 本地开发 → 本机安装更新 一键闭环（dev-install）
#
# 流程：build-app.sh 打包 → 备份现有安装 → ditto 安装到 ~/Applications
#       → launchctl kickstart -k 重启登录自启任务 → 冒烟自检
#
# 用法：
#   ./dev-install.sh                 # 完整闭环：打包 + 安装 + 重启显示窗 + 冒烟
#   ./dev-install.sh --dry-run       # 干跑：只打印将要执行的步骤与当前现场，不改任何文件
#   ./dev-install.sh --no-build      # 不重新打包，用现有 build/dist/饭桶余额.app 安装
#   ./dev-install.sh --no-smoke      # 安装后只做进程/版本基本检查，不做完整冒烟
#   ./dev-install.sh --app=<.app>    # 指定源 .app（默认 build/dist/饭桶余额.app；隐含 --no-build）
#
# 冒烟自检（默认全做）：
#   1) 进程已由 launchd 拉起（PPID=1，直启 plist 场景）
#   2) 已安装 App 的 Info.plist 版本 = 工程 package.json 版本（当前 0.0.4）
#   3) 已安装 App 签名 = 本机自签证书 "Maizi Local Code Signing" 且 flags=0x0（非 ad-hoc）
#   4) panel.log 出现本次启动的新 start 行（版本与 Info.plist 一致）
#   5) 定位器 detect 生效：panel.log 出现 place src=detect（或启动时的 panel shown ... src=detect/detect）；
#      若只出现 place src=fallback-* 且等不到 detect → 记 WARN「屏幕录制未授权」，不判失败（退出码 3）
#
# 退出码：0 = 完整冒烟通过；1 = 安装/冒烟失败（已自动回滚到本次备份）；2 = 用法/输入错误；
#         3 = 安装成功但屏幕录制未授权（只出现 place=fallback、等不到 detect；给权限后重跑即可复验）
#
# 设计：
#   · 只更新本机安装，不改 LaunchAgent plist（plist 由 install.sh 写；本脚本只 bootout/bootstrap/kickstart）
#   · 安装前把现有 ~/Applications/饭桶余额.app 备份成 饭桶余额.app.bak-pre-devinstall-<时间戳>；
#     安装或冒烟失败自动把备份移回（自动回滚）；成功则保留备份，手工回滚命令见结尾提示
#   · build-app.sh 的签名/版本硬校验在 build/dist/ 阶段已通过，本脚本安装后再对「已安装副本」复验一遍

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_NAME="饭桶余额"
LABEL="com.maimai.petbalancepanel"
APP_BUNDLE_ID="com.maimai.petbalancepanel"
SIGN_IDENTITY="Maizi Local Code Signing"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/${APP_NAME}.app"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/饭桶余额"
PANEL_LOG="$HOME/.dsh/pet-balance-panel/panel.log"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
BIN="$DEST/Contents/MacOS/Electron"

DO_BUILD=1
DO_SMOKE=1
DRY=0
SRC_APP=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --no-build) DO_BUILD=0 ;;
    --no-smoke) DO_SMOKE=0 ;;
    --app=*) SRC_APP="${1#--app=}"; DO_BUILD=0 ;;
    --help|-h)
      awk 'NR==1{next} /^set -uo pipefail$/{exit} {sub(/^# ?/,""); print}' "$0"
      exit 0 ;;
    *) echo "未知参数：${1}（用 --help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

SRC_APP="${SRC_APP:-$SCRIPT_DIR/dist/${APP_NAME}.app}"
BAK="$DEST.bak-pre-devinstall-$(date +%Y%m%d-%H%M%S)"

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf '\n❌ %s\n' "$*" >&2; exit 1; }

plist_get() { /usr/libexec/PlistBuddy -c "Print :$1" "$2" 2>/dev/null || true; }

# 工程期望版本：以 package.json 为唯一来源（build-app.sh 的 APP_VERSION 必须与它同号）
EXPECT_VER="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$PROJECT_ROOT/package.json" 2>/dev/null | head -1)"
[ -n "$EXPECT_VER" ] || die "读不到 $PROJECT_ROOT/package.json 的 version 字段"
EXPECT_BIN="$SCRIPT_DIR/dist/${APP_NAME}.app/Contents/MacOS/Electron"

# 当前现场（只读）
cur_ver="$(plist_get CFBundleShortVersionString "$DEST/Contents/Info.plist")"
cur_job="no"; launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 && cur_job="yes"
cur_pid="$(pgrep -f "$BIN" 2>/dev/null | head -1)"
cur_sig_ok="no"; cur_auth=""; cur_flags=""
if [ -d "$DEST" ]; then
  _dv="$(codesign -dv --verbose=4 "$DEST" 2>&1 || true)"
  cur_auth="$(printf '%s\n' "$_dv" | sed -n 's/^Authority=//p' | head -1)"
  cur_flags="$(printf '%s\n' "$_dv" | grep -o 'flags=0x[0-9a-fA-F]*([^)]*)' | head -1)"
  cur_flags="${cur_flags#flags=}"
  if codesign --verify --deep --strict "$DEST" >/dev/null 2>&1; then cur_sig_ok="yes"; fi
fi

# ---------- dry-run：只打印计划与现状，绝不改文件 ----------
if [ "$DRY" -eq 1 ]; then
  step "dry-run：以下是完整闭环将执行的步骤（本次不打包、不复制、不启停进程）"
  say "  工程：        $PROJECT_ROOT"
  say "  期望版本：    ${EXPECT_VER}（来自 package.json）"
  say ""
  say "  步骤 1/5 打包： $( [ "$DO_BUILD" -eq 1 ] && echo "会跑 $SCRIPT_DIR/build-app.sh → $SRC_APP" || echo "按 --no-build/--app，跳过打包，源 = $SRC_APP" )"
  say "  步骤 2/5 备份： $( [ -d "$DEST" ] && echo "现有安装 $( [ -n "$cur_ver" ] && echo "v$cur_ver" || echo '版本未知' ) → 备份成 $BAK" || echo "$DEST 不存在，无需备份（首次安装）" )"
  say "  步骤 3/5 安装： ditto 复制到 ${DEST}（先确保旧实例已停）"
  if [ "$cur_job" = "yes" ]; then
    say "  步骤 4/5 重启： launchd 任务已存在（pid ${cur_pid:-无}）→ launchctl kickstart -k gui/$UID_NUM/$LABEL"
  elif [ -f "$PLIST" ]; then
    say "  步骤 4/5 重启： launchd 任务未加载，但 plist 存在 → launchctl bootstrap gui/$UID_NUM + kickstart"
  else
    say "  步骤 4/5 重启： ⚠ 找不到 plist（${PLIST}）→ 会失败并提示先跑 ./install.sh（本脚本不写 LaunchAgents）"
  fi
  if [ "$DO_SMOKE" -eq 1 ]; then
    say "  步骤 5/5 冒烟： 进程起来 / Info.plist 版本=$EXPECT_VER / 签名 Authority=$SIGN_IDENTITY+flags=0x0 /"
    say "                panel.log 新 start 行（v${EXPECT_VER}）/ 定位器 detect 生效（place src=detect 或 panel shown src=detect/detect；无授权则 WARN+退出码 3）"
  else
    say "  步骤 5/5 冒烟： 按 --no-smoke，只查进程与版本"
  fi
  say ""
  say "  当前安装：    $( [ -d "$DEST" ] && echo "${DEST}（版本 ${cur_ver:-?}，签名校验 ${cur_sig_ok}，Authority=${cur_auth:-?}，flags=${cur_flags:-?}）" || echo '未安装' )"
  say "  登录自启：    $( [ "$cur_job" = "yes" ] && echo "launchd 已加载任务 ${LABEL}（pid ${cur_pid:-无}）" || echo 'launchd 里没有该任务' )"
  say "  运行日志：    $PANEL_LOG"
  say "  launchd 日志：$LOG_DIR/launch.log / launch.err.log"
  say ""
  say "  （dry-run 结束：以上都没实际执行）"
  exit 0
fi

# ---------- 1. 打包 ----------
step "1/5 打包（build-app.sh）"
if [ "$DO_BUILD" -eq 1 ]; then
  [ -x "$SCRIPT_DIR/build-app.sh" ] || die "找不到可执行的 build-app.sh：$SCRIPT_DIR/build-app.sh"
  "$SCRIPT_DIR/build-app.sh" || die "打包失败（见上面 build-app.sh 的报错；未动现有安装）"
else
  ok "按 --no-build/--app，跳过打包"
fi
[ -d "$SRC_APP" ] || die "源 app 不存在：${SRC_APP}（先跑 ./build-app.sh，或去掉 --no-build）"
[ -x "$SRC_APP/Contents/MacOS/Electron" ] || die "源 app 不完整（缺可执行文件）：$SRC_APP"
[ -f "$SRC_APP/Contents/Info.plist" ] || die "源 app 不完整（缺 Info.plist）：$SRC_APP"

SRC_VER="$(plist_get CFBundleShortVersionString "$SRC_APP/Contents/Info.plist")"
SRC_ID="$(plist_get CFBundleIdentifier "$SRC_APP/Contents/Info.plist")"
[ "$SRC_VER" = "$EXPECT_VER" ] || die "源 app 版本 ${SRC_VER:-?} ≠ 工程 package.json 版本 ${EXPECT_VER}（build-app.sh 的 APP_VERSION 是否没同步？）"
[ "$SRC_ID" = "$APP_BUNDLE_ID" ] || die "源 app bundle id ${SRC_ID:-?} ≠ $APP_BUNDLE_ID"
SRC_SIZE="$(du -sh "$SRC_APP" | awk '{print $1}')"
ok "源包：${SRC_APP}（${SRC_SIZE}，v${SRC_VER}，${SRC_ID}）"

# 源包签名预检（build-app.sh 已硬校验；这里再核一遍，避免用错产物装出去）
SRC_DV="$(codesign -dv --verbose=4 "$SRC_APP" 2>&1 || true)"
SRC_AUTH="$(printf '%s\n' "$SRC_DV" | sed -n 's/^Authority=//p' | head -1)"
SRC_FLAGS="$(printf '%s\n' "$SRC_DV" | grep -o 'flags=0x[0-9a-fA-F]*([^)]*)' | head -1)"
SRC_FLAGS="${SRC_FLAGS#flags=}"
[ "$SRC_AUTH" = "$SIGN_IDENTITY" ] || die "源包签名身份不是 \"$SIGN_IDENTITY\"（实际 Authority=${SRC_AUTH:-?}）"
case "$SRC_FLAGS" in 0x0*) : ;; *) die "源包签名 flags 不是 0x0（实际 ${SRC_FLAGS:-?}，可能误用了 ad-hoc）" ;; esac
ok "源包签名：Authority=${SRC_AUTH}，flags=${SRC_FLAGS}"

# ---------- 2. 备份现有安装 ----------
step "2/5 备份现有安装"
if [ -d "$DEST" ]; then
  mv "$DEST" "$BAK" || die "备份现有安装失败：$DEST → ${BAK}（未继续安装）"
  ok "已备份：$DEST → $BAK"
else
  BAK=""
  ok "现有安装不存在，无需备份（首次安装）"
fi

ROLLBACK_NEEDED=1
ROLLED_BACK=0
rollback() {
  # 自动回滚：停新实例 → 删装了一半的 app → 备份移回 → 重新加载 launchd
  [ "$ROLLED_BACK" -eq 1 ] && return 0
  ROLLED_BACK=1
  warn "开始自动回滚（恢复安装前状态）"
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  pkill -f "$BIN" >/dev/null 2>&1 || true
  sleep 1
  if [ -n "$BAK" ] && [ -d "$BAK" ]; then
    rm -rf "$DEST"
    if mv "$BAK" "$DEST"; then ok "已恢复备份：$DEST"; else warn "恢复备份失败！备份仍在：$BAK"; fi
  else
    rm -rf "$DEST"
    ok "已删除本次装了一半的 app（原来就没有安装）"
  fi
  if [ -f "$PLIST" ]; then
    launchctl bootstrap "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
    launchctl kickstart "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    ok "已重新加载登录自启任务（旧版本）"
  fi
}
trap '[ "$ROLLBACK_NEEDED" -eq 1 ] && rollback' EXIT

# ---------- 3. 停旧实例 → 安装 ----------
step "3/5 停止旧实例并安装"
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  ok "已 bootout 旧自启任务（launchd 会收掉旧实例）"
else
  ok "launchd 里没有旧任务"
fi
i=0
while [ "$i" -lt 20 ] && { [ -n "$(pgrep -f "$BIN" 2>/dev/null)" ] || [ -n "$(pgrep -f "$HOME/.dsh/pet-balance-panel/launch-via-dsh.mjs" 2>/dev/null)" ]; }; do
  sleep 0.3; i=$((i + 1))
done
# 兜底：按精确路径结束残留（旧版 DSH 载体守护壳一并收掉）
pkill -f "$HOME/.dsh/pet-balance-panel/launch-via-dsh.mjs" >/dev/null 2>&1 || true
[ -n "$(pgrep -f "$BIN" 2>/dev/null)" ] && { pkill -f "$BIN" >/dev/null 2>&1 || true; sleep 1; }
[ -z "$(pgrep -f "$BIN" 2>/dev/null)" ] || die "旧实例未退出，无法安全替换安装"
ok "旧实例已停"

mkdir -p "$DEST_DIR" || die "建不了目录：$DEST_DIR"
ditto "$SRC_APP" "$DEST" || { rollback; die "复制安装失败：$SRC_APP → $DEST"; }
[ -x "$DEST/Contents/MacOS/Electron" ] || { rollback; die "安装后缺可执行文件，复制可能不完整"; }
# 源包在 iCloud 同步目录（~/Documents）里，ditto 会把 FinderInfo/FileProvider 扩展属性带过来，
# 导致 codesign 复验报「resource fork, Finder information…detritus」——安装到本机后清一次扩展属性。
xattr -cr "$DEST" 2>/dev/null || true
if codesign --verify --deep --strict "$DEST" >/dev/null 2>&1; then
  ok "已安装：${DEST}（签名复验通过；已清扩展属性）"
else
  VF_ERR="$(codesign --verify --deep --strict "$DEST" 2>&1 | head -2)"
  rollback
  die "安装后签名校验未通过（不启动新版本，已回滚）
  $VF_ERR"
fi

# ---------- 4. 重启登录自启任务 ----------
step "4/5 重启登录自启（launchctl）"
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl kickstart -k "$DOMAIN/$LABEL" || { rollback; die "launchctl kickstart -k 失败：$DOMAIN/$LABEL"; }
  ok "已 kickstart -k：$DOMAIN/$LABEL"
elif [ -f "$PLIST" ]; then
  launchctl bootstrap "$DOMAIN" "$PLIST" || { rollback; die "launchctl bootstrap 失败：$PLIST"; }
  ok "任务未加载，已 bootstrap：$PLIST"
  launchctl kickstart "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
else
  rollback
  die "找不到 LaunchAgent plist：$PLIST
  dev-install.sh 只负责更新安装与重启，不写 LaunchAgents。请先跑一次：./install.sh"
fi

# ---------- 5. 冒烟自检 ----------
step "5/5 冒烟自检"
FAIL=0
SMOKE_WARN=0
PANEL_OFFSET=0
[ -f "$PANEL_LOG" ] && PANEL_OFFSET="$(wc -c < "$PANEL_LOG" | tr -d ' ')"

# 5.1 进程
PID=""
i=0
while [ "$i" -lt 40 ]; do
  PID="$(pgrep -f "$BIN" 2>/dev/null | head -1)"
  [ -n "$PID" ] && break
  sleep 0.3; i=$((i + 1))
done
if [ -n "$PID" ]; then
  PPID_NUM="$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')"
  ok "显示窗进程已起来：pid ${PID}（PPID=${PPID_NUM:-?}）"
  [ "${PPID_NUM:-}" = "1" ] && ok "launchd 直启确认：PPID=1（不依赖 DSH 载体）" || warn "进程 PPID=${PPID_NUM:-?}（不是 1；若刚 kickstart 可能还没稳定，或仍由旧载体拉起）"
else
  warn "没有等到显示窗进程（pid 为空）"
  FAIL=1
fi

# 5.2 已安装副本版本
INST_VER="$(plist_get CFBundleShortVersionString "$DEST/Contents/Info.plist")"
INST_ID="$(plist_get CFBundleIdentifier "$DEST/Contents/Info.plist")"
if [ "$INST_VER" = "$EXPECT_VER" ]; then ok "已安装 Info.plist 版本 = $INST_VER"; else warn "已安装版本 ${INST_VER:-?} ≠ 期望 $EXPECT_VER"; FAIL=1; fi
[ "$INST_ID" = "$APP_BUNDLE_ID" ] && ok "已安装 bundle id = $INST_ID" || { warn "已安装 bundle id ${INST_ID:-?} ≠ $APP_BUNDLE_ID"; FAIL=1; }

# 5.3 已安装副本签名（身份 + flags + 深校验）
INST_DV="$(codesign -dv --verbose=4 "$DEST" 2>&1 || true)"
INST_AUTH="$(printf '%s\n' "$INST_DV" | sed -n 's/^Authority=//p' | head -1)"
INST_FLAGS="$(printf '%s\n' "$INST_DV" | grep -o 'flags=0x[0-9a-fA-F]*([^)]*)' | head -1)"
INST_FLAGS="${INST_FLAGS#flags=}"
[ "$INST_AUTH" = "$SIGN_IDENTITY" ] && ok "已安装签名 Authority = $INST_AUTH" || { warn "已安装签名 Authority=${INST_AUTH:-?} ≠ $SIGN_IDENTITY"; FAIL=1; }
case "$INST_FLAGS" in 0x0*) ok "已安装签名 flags = ${INST_FLAGS}（非 ad-hoc）" ;; *) warn "已安装签名 flags=${INST_FLAGS:-?}（应为 0x0）"; FAIL=1 ;; esac
if codesign --verify --deep --strict "$DEST" >/dev/null 2>&1; then
  ok "codesign --verify --deep --strict 通过（已安装副本）"
else
  warn "codesign --verify --deep --strict 未通过（已安装副本）"; FAIL=1
fi

if [ "$DO_SMOKE" -eq 1 ]; then
  # 5.4 panel.log 新 start 行 + 5.5 place src=detect
  NEWLOG=""
  i=0
  while [ "$i" -lt 60 ]; do
    if [ -f "$PANEL_LOG" ]; then
      NEWLOG="$(tail -c +$((PANEL_OFFSET + 1)) "$PANEL_LOG" 2>/dev/null)"
      printf '%s' "$NEWLOG" | grep -q "start ${APP_NAME} v${EXPECT_VER}" && break
    fi
    sleep 0.3; i=$((i + 1))
  done
  if printf '%s' "$NEWLOG" | grep -q "start ${APP_NAME} v${EXPECT_VER}"; then
    ok "panel.log 新 start 行：$(printf '%s\n' "$NEWLOG" | grep "start ${APP_NAME} v${EXPECT_VER}" | head -1 | cut -c1-120)"
  else
    warn "panel.log 没等到新的 start ${APP_NAME} v${EXPECT_VER} 行（${PANEL_LOG}）"
    FAIL=1
  fi

  # 定位器 detect 判据：place src=detect 行，或启动时的 panel shown ... src=detect/detect
  # （刚启动先 fallback 再 detect 是正常时序；detect 后不一定立刻再写 place 行，所以 panel shown 也算）
  i=0
  while [ "$i" -lt 40 ]; do
    NEWLOG="$(tail -c +$((PANEL_OFFSET + 1)) "$PANEL_LOG" 2>/dev/null)"
    printf '%s' "$NEWLOG" | grep -q "place src=detect" && break
    printf '%s' "$NEWLOG" | grep -q "panel shown .*src=detect/detect" && break
    sleep 0.3; i=$((i + 1))
  done
  if printf '%s' "$NEWLOG" | grep -q "place src=detect"; then
    ok "panel.log 有 place src=detect：$(printf '%s\n' "$NEWLOG" | grep -m1 "place src=detect" | cut -c1-140)"
  elif printf '%s' "$NEWLOG" | grep -q "panel shown .*src=detect/detect"; then
    ok "panel.log 有 panel shown ... src=detect/detect（定位器已生效、面板已按桌宠定位）：$(printf '%s\n' "$NEWLOG" | grep -m1 "panel shown" | cut -c1-160)"
  elif printf '%s' "$NEWLOG" | grep -q "place src=fallback"; then
    SMOKE_WARN=1
    warn "等不到 detect，只有 fallback：$(printf '%s\n' "$NEWLOG" | grep -m1 "place src=fallback" | cut -c1-140)"
    warn "  → 屏幕录制授权未授予（或定位器没读到桌宠）。给「饭桶余额」授一次屏幕录制后，重跑：./dev-install.sh --no-build"
    printf '%s' "$NEWLOG" | grep -q "permission guide shown reason=no-screen-permission" && warn "  → panel.log 明确记录 permission guide shown reason=no-screen-permission"
  else
    SMOKE_WARN=1
    warn "panel.log 未出现 place / panel shown 行（可能启动还慢；稍后看 ${PANEL_LOG}）"
  fi

  if [ -f "$LOG_DIR/launch.err.log" ] && [ -s "$LOG_DIR/launch.err.log" ]; then
    warn "launchd 错误日志有内容（最后 2 行）："
    tail -n 2 "$LOG_DIR/launch.err.log" | sed 's/^/      /' >&2
  fi
else
  ok "--no-smoke：跳过 panel.log 冒烟"
fi

ROLLBACK_NEEDED=0
trap - EXIT

if [ "$FAIL" -ne 0 ]; then
  rollback
  die "冒烟失败（见上面 ❌/! 项），已自动回滚到安装前状态。日志：$PANEL_LOG"
fi

step "完成"
say ""
if [ "$SMOKE_WARN" -ne 0 ]; then
  say "✅ 安装更新完成（1 项 WARN：屏幕录制未授权，place=fallback → 退出码 3）"
else
  say "✅ 安装更新完成，冒烟全部通过"
fi
say "   已安装：${DEST}（v${INST_VER}，签名 ${INST_AUTH}，flags=${INST_FLAGS}）"
say "   进程：  ${PID:-?}（PPID=${PPID_NUM}）"
say "   日志：  $PANEL_LOG"
say "   备份：  $( [ -n "$BAK" ] && echo "$BAK" || echo '无（首次安装）' )"
if [ -n "$BAK" ]; then
  say "   手工回滚：launchctl bootout $DOMAIN/$LABEL; rm -rf \"$DEST\"; mv \"$BAK\" \"$DEST\"; launchctl bootstrap $DOMAIN \"$PLIST\""
fi
say ""
[ "$SMOKE_WARN" -ne 0 ] && exit 3
exit 0
