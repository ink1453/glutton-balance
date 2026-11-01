#!/bin/bash
# 卸载「饭桶余额」：停登录自启（含 DSH 载体守护壳）→ 退出程序 → 删自启 plist/守护壳 → 删 app（保留用户配置）
#
# 用法：
#   ./uninstall.sh              # 标准卸载（删程序 + 删自启，保留用户配置与日志）
#   ./uninstall.sh --keep-app   # 只删自启（含 DSH 载体守护壳），不删 ~/Applications 里的 app
#   ./uninstall.sh --purge      # 连用户配置一起删（另需 --yes 明确确认）
#   ./uninstall.sh --yes        # 配合 --purge 用，跳过二次确认
#   ./uninstall.sh --dry-run    # 干跑：只打印计划，不删任何东西
#
# 自启方案（2026-11-01 第2轮 A1 起 = 「DSH 载体 + 守护壳」）：
#   · LaunchAgent ~/Library/LaunchAgents/com.ricebowl.petbalancepanel.plist 跑的是 DSH 载体：
#     DeepSeek Harness 主程序以 Node 模式执行守护壳 ~/.dsh/pet-balance-panel/launch-via-dsh.mjs，
#     再由守护壳 spawn 显示窗（显示窗继承 DSH 的屏幕录制授权）。
#   · 卸载自启 = bootout + 删 plist + 删 DSH 载体守护壳 + 清载体迁移前的 plist 备份（*.bak-pre-dsh-*）；
#     不动 DSH 本体，也不动系统隐私设置。
#
# 设计：
#   · 幂等：没装过也能跑，只打印「本来就没装」
#   · 可回滚：卸载后重新跑 ./install.sh 就恢复（LaunchAgent 与 DSH 载体守护壳都会重新生成）
#   · 默认不删用户配置：~/.dsh/pet-balance-panel/ 里的 config.json、panel.log
#     （同目录的 launch-via-dsh.mjs 是安装脚本生成的自启守护壳、不是用户配置，会删；重装会重建）
#     也保留 ~/Library/Application Support/饭桶余额/（Electron 自己的 userData）
#     以及 ~/Library/Logs/饭桶余额/
#   · 不删系统设置/权限记录：屏幕录制授权记录由 macOS 管理（DSH 载体方案下授权归 DSH，卸载本项目不碰）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_NAME="饭桶余额"
LABEL="com.ricebowl.petbalancepanel"
DEST_DIR="$HOME/Applications"
DEST="$DEST_DIR/${APP_NAME}.app"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/饭桶余额"
CONFIG_DIR="$HOME/.dsh/pet-balance-panel"
WRAPPER="$CONFIG_DIR/launch-via-dsh.mjs"
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

# DSH 载体进程识别：argv 里带守护壳路径（pgrep 不会匹配自己；点号转义避免正则误解）
WRAPPER_RE="${WRAPPER//./\\.}"
carrier_pids() { pgrep -f "$WRAPPER_RE" 2>/dev/null || true; }

# 载荷体迁移前留下的 plist 备份（旧「launchd 直起显示窗」方案的 .bak-pre-dsh-*）
BACKUP_PLISTS=()
for _f in "$HOME/Library/LaunchAgents/${LABEL}.plist.bak-pre-dsh-"*; do
  [ -e "$_f" ] && BACKUP_PLISTS+=("$_f")
done

# ---- dry-run：只打印计划，不删任何东西 ----
if [ "$DRY" -eq 1 ]; then
  step "dry-run：以下是将要执行的计划（本次不删任何文件、不退出程序、不动 DSH）"
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    say "  登录自启：  有已加载的 launchd 任务（${LABEL}，DSH 载体），会先 bootout"
  else
    say "  登录自启：  launchd 里没有任务（不用动）"
  fi
  CARRIER_PIDS="$(carrier_pids | tr '\n' ' ')"
  if [ -n "$CARRIER_PIDS" ]; then
    say "  DSH 载体：  有载体进程在跑（pid ${CARRIER_PIDS% }）；bootout 后若残留会按守护壳路径收掉"
  else
    say "  DSH 载体：  没有载体进程在跑"
  fi
  if [ -f "$PLIST" ]; then
    say "  自启文件：  存在 ${PLIST}，会删除"
  else
    say "  自启文件：  不存在（无操作）"
  fi
  if [ -f "$WRAPPER" ]; then
    say "  载体守护壳：存在 ${WRAPPER}，会删除（DSH 载体方案的生成物；重装 install.sh 会重建）"
  else
    say "  载体守护壳：不存在（旧方案或本来就没装自启）"
  fi
  if [ "${#BACKUP_PLISTS[@]}" -gt 0 ]; then
    say "  旧自启备份：发现 ${#BACKUP_PLISTS[@]} 个载体迁移前 plist 备份（旧 launchd 直起方案），会一起删："
    for _f in "${BACKUP_PLISTS[@]}"; do say "              ${_f}"; done
  else
    say "  旧自启备份：没有（无操作）"
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
    say "  用户配置：  按 --purge，会删除 ${CONFIG_DIR}（含 config.json / panel.log）、${USERDATA_DIR}、${LOG_DIR}（不可恢复，需输 YES 确认）"
  else
    say "  用户配置：  保留 ${CONFIG_DIR}（config.json / panel.log；守护壳已单独删）、${USERDATA_DIR}、$LOG_DIR"
  fi
  say "  DSH 本体：  不碰（只删本项目的 LaunchAgent 与守护壳；DSH 与它的屏幕录制授权保留）"
  say "  系统权限：  不碰（屏幕录制记录归 macOS/DSH 管理，要清由老板自己去系统设置）"
  say ""
  say "  （dry-run 结束：以上都没实际执行）"
  exit 0
fi

step "1/5 停掉登录自启（LaunchAgent + DSH 载体守护壳）"
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  if launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    ok "已从 launchd 移除任务：$LABEL（DSH 载体会收到 SIGTERM）"
  else
    warn "launchctl bootout 失败（任务可能还在 launchd 里）；守护壳与 plist 仍按计划清理，重启后可彻底生效"
  fi
else
  ok "launchd 里本来就没有这个任务"
fi

# DSH 载体的 argv 里带守护壳路径：bootout 后正常会自己退；残留则按路径精确收掉
i=0
while [ "$i" -lt 10 ] && [ -n "$(carrier_pids)" ]; do
  sleep 0.2
  i=$((i + 1))
done
if [ -n "$(carrier_pids)" ]; then
  warn "DSH 载体还在跑，先 SIGTERM 收掉（守护壳会把显示窗一起带走）"
  pkill -TERM -f "$WRAPPER_RE" >/dev/null 2>&1 || true
  sleep 1
  if [ -n "$(carrier_pids)" ]; then
    warn "DSH 载体还没退，兜底 SIGKILL"
    pkill -KILL -f "$WRAPPER_RE" >/dev/null 2>&1 || true
    sleep 0.3
  fi
  ok "DSH 载体已结束"
else
  ok "DSH 载体本来就没在跑"
fi

if [ -f "$PLIST" ]; then
  rm -f "$PLIST" && ok "已删自启文件（LaunchAgent）：$PLIST"
else
  ok "本来就没有自启文件：$PLIST"
fi

if [ "${#BACKUP_PLISTS[@]}" -gt 0 ]; then
  for _f in "${BACKUP_PLISTS[@]}"; do
    rm -f "$_f" && ok "已删载体迁移前的 plist 备份：$_f"
  done
else
  ok "没有载体迁移前的 plist 备份（无操作）"
fi

if [ -f "$WRAPPER" ]; then
  rm -f "$WRAPPER" && ok "已删 DSH 载体守护壳：$WRAPPER（重装 install.sh 会重建）"
else
  ok "本来就没有 DSH 载体守护壳：$WRAPPER"
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
    warn "--purge 会删掉用户配置（${CONFIG_DIR}），这是不可恢复的"
    printf '  确认请输入大写 YES 回车（其它任意输入=取消）：'
    ANSWER=""
    read -r ANSWER || true
    [ "$ANSWER" = "YES" ] || { warn "没确认，跳过删除用户数据（程序已卸载完）"; PURGE=0; }
  fi
fi
if [ "$PURGE" -eq 1 ]; then
  for d in "$CONFIG_DIR" "$USERDATA_DIR" "$LOG_DIR"; do
    if [ -e "$d" ]; then rm -rf "$d" && ok "已删：$d"; fi
  done
else
  ok "保留用户配置：${CONFIG_DIR}（config.json / panel.log 都在，重装即恢复）"
  [ -e "$USERDATA_DIR" ] && ok "保留 Electron 数据：$USERDATA_DIR"
  [ -e "$LOG_DIR" ] && ok "保留运行日志：$LOG_DIR"
fi

step "5/5 完成"
say ""
say "✅ 卸载完成"
say "   程序：$( [ -d "$DEST" ] && echo "仍保留 $DEST" || echo '已删除' )"
say "   登录自启：已关闭（LaunchAgent 已删）"
say "   DSH 载体：已清理（守护壳 launch-via-dsh.mjs + 载体迁移前 plist 备份；DSH 本体及其屏幕录制授权不动）"
say "   用户配置：$( [ "$PURGE" -eq 1 ] && echo '已按 --purge 删除' || echo '保留（默认不删）' )"
say ""
say "想再装回来：$SCRIPT_DIR/install.sh（会重建 LaunchAgent 与 DSH 载体守护壳）"
say ""
say "屏幕录制授权说明（DSH 载体方案）："
say "  · 自启拉起的显示窗继承 DSH 的屏幕录制授权；卸载本项目不会改 DSH、也不会清任何屏幕录制记录。"
say "  · 如果系统设置里还残留「饭桶余额」自己的屏幕录制条目，可自己去「系统设置 → 隐私与安全性 → 屏幕录制」关掉或点减号删除。"
