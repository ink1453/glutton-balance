#!/bin/bash
# 卸载「饭桶余额」：停登录自启（launchd 直启 App）→ 退出程序 → 删自启 plist → 删 app（保留用户配置）
#
# 用法：
#   ./uninstall.sh              # 标准卸载（删程序 + 删自启，保留用户配置与日志）
#   ./uninstall.sh --keep-app   # 只删自启，不删 ~/Applications 里的 app
#   ./uninstall.sh --purge      # 连用户配置一起删（另需 --yes 明确确认）
#   ./uninstall.sh --yes        # 配合 --purge 用，跳过二次确认
#   ./uninstall.sh --dry-run    # 干跑：只打印计划，不删任何东西
#
# 自启方案（2026-11-01 第 11 轮起 = 「launchd 直启 App」；2026-11-02 改名后 label = com.gluttonbalance.panel）：
#   · LaunchAgent ~/Library/LaunchAgents/com.gluttonbalance.panel.plist 直接拉
#     ~/Applications/饭桶余额.app/Contents/MacOS/Electron --autostart（KeepAlive=true）；
#     显示窗自己持屏幕录制授权，不再依赖 DeepSeek Harness 当载体。
#   · 卸载自启 = bootout + 删 plist + 清旧世代遗留（旧世代 DSH 载体守护壳 launch-via-dsh.mjs 与
#     旧 bundle id com.ricebowl.* 的 plist、本项目的 plist 迁移备份 *.bak-*）；
#     不动 DeepSeek Harness 本体，也不动系统隐私设置。
#
# 设计：
#   · 幂等：没装过也能跑，只打印「本来就没装」
#   · 可回滚：卸载后重新跑 ./install.sh 就恢复（LaunchAgent 会重新生成）
#   · 默认不删用户配置：~/.dsh/glutton-balance/ 里的 config.json、panel.log
#     （改名前的旧目录 ~/.dsh/pet-balance-panel 默认也保留，方便回滚；--purge 时一起删）
#   · 不删系统设置/权限记录：屏幕录制授权记录由 macOS 管理（需要的话老板自己去系统设置删）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_NAME="饭桶余额"
LABEL="com.gluttonbalance.panel"
# 旧世代 bundle id（升级/回滚时清理）
LEGACY_LABEL="com.ricebowl.petbalancepanel"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/${APP_NAME}.app"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LEGACY_PLIST="$HOME/Library/LaunchAgents/${LEGACY_LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/饭桶余额"
CONFIG_DIR="$HOME/.dsh/glutton-balance"
PREV_CONFIG_DIR="$HOME/.dsh/pet-balance-panel"
LEGACY_WRAPPER="$PREV_CONFIG_DIR/launch-via-dsh.mjs"
USERDATA_DIR="$HOME/Library/Application Support/${APP_NAME}"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
BIN="$DEST/Contents/MacOS/Electron"

KEEP_APP=0
PURGE=0
ASSUME_YES=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --keep-app) KEEP_APP=1 ;;
    --purge) PURGE=1 ;;
    --yes|-y) ASSUME_YES=1 ;;
    --dry-run) DRY=1 ;;
    --dest=*) DEST_DIR="${1#--dest=}"; DEST="$DEST_DIR/${APP_NAME}.app"; BIN="$DEST/Contents/MacOS/Electron" ;;
    --help|-h)
      # 只截到 `set -uo pipefail` 前一行，避免头注释增删后行号漂移把代码当帮助打出来
      awk 'NR==1{next} /^set -uo pipefail$/{exit} {sub(/^# ?/,""); print}' "$0"
      exit 0 ;;
    *) echo "未知参数：${1}（用 --help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }

# 本项目遗留物（旧世代 DSH 载体 / 旧 bundle id / plist 迁移备份）
WRAPPER_RE="${LEGACY_WRAPPER//./\\.}"
carrier_pids() { pgrep -f "$WRAPPER_RE" 2>/dev/null || true; }
BACKUP_PLISTS=()
for _f in "$HOME/Library/LaunchAgents/${LABEL}.plist.bak-"* "$HOME/Library/LaunchAgents/${LEGACY_LABEL}.plist.bak-"*; do
  [ -e "$_f" ] && BACKUP_PLISTS+=("$_f")
done

# ---- dry-run：只打印计划，不删任何东西 ----
if [ "$DRY" -eq 1 ]; then
  step "dry-run：以下是将要执行的计划（本次不删任何文件、不退出程序、不动 DSH）"
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    say "  登录自启：  有已加载的 launchd 任务（${LABEL}，直启 App），会先 bootout"
  else
    say "  登录自启：  launchd 里没有任务（不用动）"
  fi
  if launchctl print "$DOMAIN/$LEGACY_LABEL" >/dev/null 2>&1; then
    say "  旧世代自启：有旧 bundle id 的 launchd 任务（${LEGACY_LABEL}），会 bootout"
  else
    say "  旧世代自启：没有旧 bundle id 任务"
  fi
  if [ -f "$PLIST" ]; then
    say "  自启文件：  存在 ${PLIST}，会删除"
  else
    say "  自启文件：  不存在（无操作）"
  fi
  CARRIER_PIDS="$(carrier_pids | tr '\n' ' ')"
  if [ -n "$CARRIER_PIDS" ]; then
    say "  旧载体进程：有旧版 DSH 载体守护壳在跑（pid ${CARRIER_PIDS% }），会按路径收掉"
  else
    say "  旧载体进程：没有旧版 DSH 载体守护壳在跑"
  fi
  if [ -f "$LEGACY_WRAPPER" ]; then
    say "  旧载体守护壳：存在 ${LEGACY_WRAPPER}，会删除（旧世代生成物，重装不会重建）"
  else
    say "  旧载体守护壳：不存在（无操作）"
  fi
  if [ "${#BACKUP_PLISTS[@]}" -gt 0 ]; then
    say "  plist 备份：发现 ${#BACKUP_PLISTS[@]} 个本项目的自启 plist 备份，会一起删："
    for _f in "${BACKUP_PLISTS[@]}"; do say "              ${_f}"; done
  else
    say "  plist 备份：没有（无操作）"
  fi
  if pgrep -f "$DEST/Contents/MacOS/Electron" >/dev/null 2>&1; then
    say "  运行实例：  有，会先 --quit 温和退出（兜底按路径结束）"
  else
    say "  运行实例：  没有在运行"
  fi
  if [ "$KEEP_APP" -eq 1 ]; then
    say "  程序：      按 --keep-app，保留 $DEST"
  elif [ -d "$DEST" ]; then
    say "  程序：      会删除 $DEST"
  else
    say "  程序：      $DEST 本来就没装（无操作）"
  fi
  if [ "$PURGE" -eq 1 ]; then
    say "  用户配置：  按 --purge，会删除 ${CONFIG_DIR}（含 config.json / panel.log）、旧目录 ${PREV_CONFIG_DIR}、${USERDATA_DIR}、${LOG_DIR}（不可恢复，需输 YES 确认）"
  else
    say "  用户配置：  保留 ${CONFIG_DIR}（config.json / panel.log）、旧目录 ${PREV_CONFIG_DIR}、${USERDATA_DIR}、$LOG_DIR"
  fi
  say "  DSH 本体：  不碰（只删本项目的 LaunchAgent 与旧世代守护壳；DSH 与它的屏幕录制授权保留）"
  say "  系统权限：  不碰（屏幕录制记录归 macOS 管理，要清由老板自己去系统设置）"
  say ""
  say "  （dry-run 结束：以上都没实际执行）"
  exit 0
fi

step "1/5 停掉登录自启（LaunchAgent）"
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  if launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    ok "已从 launchd 移除任务：$LABEL"
  else
    warn "launchctl bootout 失败（任务可能还在 launchd 里）；plist 仍按计划清理，重启后可彻底生效"
  fi
else
  ok "launchd 里本来就没有这个任务"
fi
if launchctl print "$DOMAIN/$LEGACY_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LEGACY_LABEL" >/dev/null 2>&1 && ok "已移除旧世代 bundle id 任务：$LEGACY_LABEL" || warn "旧世代 bundle id 任务 bootout 失败"
fi

# 旧世代 DSH 载体守护壳进程：bootout 后正常会自己退；残留则按路径精确收掉
i=0
while [ "$i" -lt 10 ] && [ -n "$(carrier_pids)" ]; do
  sleep 0.2
  i=$((i + 1))
done
if [ -n "$(carrier_pids)" ]; then
  warn "旧版 DSH 载体守护壳还在跑，先 SIGTERM 收掉（它会把旧显示窗一起带走）"
  pkill -TERM -f "$WRAPPER_RE" >/dev/null 2>&1 || true
  sleep 1
  if [ -n "$(carrier_pids)" ]; then
    warn "旧载体还没退，兜底 SIGKILL"
    pkill -KILL -f "$WRAPPER_RE" >/dev/null 2>&1 || true
    sleep 0.3
  fi
  ok "旧版 DSH 载体守护壳已结束"
else
  ok "旧版 DSH 载体守护壳本来就没在跑"
fi

if [ -f "$PLIST" ]; then
  rm -f "$PLIST" && ok "已删自启文件（LaunchAgent）：$PLIST"
else
  ok "本来就没有自启文件：$PLIST"
fi
if [ -f "$LEGACY_PLIST" ]; then
  rm -f "$LEGACY_PLIST" && ok "已删旧世代 bundle id 自启文件：$LEGACY_PLIST"
fi
if [ "${#BACKUP_PLISTS[@]}" -gt 0 ]; then
  for _f in "${BACKUP_PLISTS[@]}"; do
    rm -f "$_f" && ok "已删自启 plist 备份：$_f"
  done
else
  ok "没有自启 plist 备份（无操作）"
fi
if [ -f "$LEGACY_WRAPPER" ]; then
  rm -f "$LEGACY_WRAPPER" && ok "已删旧版 DSH 载体守护壳：$LEGACY_WRAPPER"
else
  ok "本来就没有旧版 DSH 载体守护壳：$LEGACY_WRAPPER"
fi

step "2/5 退出正在运行的程序"
if pgrep -f "$DEST/Contents/MacOS/Electron" >/dev/null 2>&1; then
  if [ -x "$BIN" ]; then
    env -u ELECTRON_RUN_AS_NODE "$BIN" --quit >/dev/null 2>&1 || true
  fi
  i=0
  while [ "$i" -lt 10 ]; do
    pgrep -f "$DEST/Contents/MacOS/Electron" >/dev/null 2>&1 || break
    sleep 0.3
    i=$((i + 1))
  done
  if pgrep -f "$DEST/Contents/MacOS/Electron" >/dev/null 2>&1; then
    warn "程序没自己退，按路径精确结束它"
    pkill -f "$DEST/Contents/MacOS/Electron" >/dev/null 2>&1 || true
    sleep 1
  fi
  ok "程序已退出"
else
  ok "程序本来就没在运行"
fi

step "3/5 删程序"
if [ "$KEEP_APP" -eq 1 ]; then
  ok "--keep-app：保留 $DEST"
elif [ -d "$DEST" ]; then
  rm -rf "$DEST" && ok "已删：$DEST"
else
  ok "本来就没装：$DEST"
fi

step "4/5 用户数据"
if [ "$PURGE" -eq 1 ]; then
  if [ "$ASSUME_YES" -ne 1 ]; then
    warn "--purge 会删掉用户配置（${CONFIG_DIR} 与旧目录 ${PREV_CONFIG_DIR}），这是不可恢复的"
    printf '  确认请输入大写 YES 回车（其它任意输入=取消）：'
    ANSWER=""
    read -r ANSWER || true
    [ "$ANSWER" = "YES" ] || { warn "没确认，跳过删除用户数据（程序已卸载完）"; PURGE=0; }
  fi
fi
if [ "$PURGE" -eq 1 ]; then
  for d in "$CONFIG_DIR" "$PREV_CONFIG_DIR" "$USERDATA_DIR" "$LOG_DIR"; do
    if [ -e "$d" ]; then rm -rf "$d" && ok "已删：$d"; fi
  done
else
  ok "保留用户配置：${CONFIG_DIR}（config.json / panel.log 都在，重装即恢复）"
  [ -e "$PREV_CONFIG_DIR" ] && ok "保留改名前的旧配置目录：${PREV_CONFIG_DIR}（可回滚，--purge 时一起删）"
  [ -e "$USERDATA_DIR" ] && ok "保留 Electron 数据：$USERDATA_DIR"
  [ -e "$LOG_DIR" ] && ok "保留运行日志：$LOG_DIR"
fi

step "5/5 完成"
say ""
say "✅ 卸载完成"
say "   程序：$( [ -d "$DEST" ] && echo "仍保留 $DEST" || echo '已删除' )"
say "   登录自启：已关闭（LaunchAgent 已删）"
say "   旧世代遗留：已清理（旧世代 DSH 载体守护壳 / 旧 bundle id 的 plist；DSH 本体及其屏幕录制授权不动）"
say "   用户配置：$( [ "$PURGE" -eq 1 ] && echo '已按 --purge 删除' || echo '保留（默认不删）' )"
say ""
say "想再装回来：$SCRIPT_DIR/install.sh（会重建 LaunchAgent）"
say ""
say "屏幕录制授权说明（launchd 直启 App 方案）："
say "  · 显示窗自己持屏幕录制授权（授权记录归「饭桶余额」）；卸载本项目不会清掉任何屏幕录制记录。"
say "  · 如果系统设置里还残留「饭桶余额」的屏幕录制条目，可自己去「系统设置 → 隐私与安全性 → 屏幕录制」关掉或点减号删除。"
