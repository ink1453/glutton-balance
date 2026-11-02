#!/bin/bash
# 安装「饭桶余额」：复制 app 到 ~/Applications + 写登录自启 LaunchAgent（launchd 直启 App）并立刻启动
#
# 用法：
#   ./install.sh                    # 正常安装（复制 + 设登录自启 + 立刻启动）
#   ./install.sh --no-autostart     # 只装 app，不写自启（验收/临时看效果用）
#   ./install.sh --no-start         # 写自启但不马上启动（下次登录才起）
#   ./install.sh --dry-run          # 干跑：只打印计划，不复制/不写 plist/不启动
#   ./install.sh --app=<别的.app>   # 指定源 .app（默认 build/dist/饭桶余额.app）
#
# 设计（2026-11-01 第 11 轮起 = 「LaunchAgent 直启 App」）：
#   · App 用本机自签证书 "Maizi Local Code Signing" 签名（build-app.sh 保证，禁 ad-hoc）→
#     显示窗自己持屏幕录制授权，不再依赖 DeepSeek Harness 当载体（旧方案已下线）。
#   · 自启 = ~/Library/LaunchAgents/com.gluttonbalance.panel.plist：
#       Label=com.gluttonbalance.panel
#       ProgramArguments=[~/Applications/饭桶余额.app/Contents/MacOS/Electron, --autostart]
#       RunAtLoad=true / KeepAlive=true / LimitLoadToSessionType=Aqua
#       ProcessType=Interactive / ThrottleInterval=10
#       日志 → ~/Library/Logs/饭桶余额/launch.log / launch.err.log
#     plist 里绝不写 ELECTRON_RUN_AS_NODE（那是 DSH 会话的 shell 开发变量，用户登录环境没有）。
#   · 幂等：重复跑会先停旧实例、覆盖旧文件、替换旧 plist，不重复追加。
#   · 可回滚：uninstall.sh 一键反向（不删用户配置）。
#   · 不动系统设置、不代点权限弹窗（屏幕录制要老板自己在系统设置给「饭桶余额」点一次，见 build/PERMISSIONS.md）。

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_SRC="$SCRIPT_DIR/dist/饭桶余额.app"
APP_NAME="饭桶余额"
DEST_DIR="$HOME/Applications"
LABEL="com.gluttonbalance.panel"
# 旧世代（DSH 载体方案 / 旧 bundle id）的遗留物：安装时顺手清理，避免两套自启打架
# com.ricebowl.* = 旧世代
LEGACY_LABEL="com.ricebowl.petbalancepanel"
LEGACY_PLIST="$HOME/Library/LaunchAgents/${LEGACY_LABEL}.plist"
LEGACY_WRAPPER="$HOME/.dsh/pet-balance-panel/launch-via-dsh.mjs"
LOG_DIR="$HOME/Library/Logs/饭桶余额"
AUTOSTART=1
NO_START=0
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --app=*) APP_SRC="${1#--app=}" ;;
    --dest=*) DEST_DIR="${1#--dest=}" ;;
    --no-autostart) AUTOSTART=0 ;;
    --no-start) NO_START=1 ;;
    --dry-run) DRY=1 ;;
    --help|-h)
      # 只截到 `set -uo pipefail` 前一行，避免头注释增删后行号漂移把代码当帮助打出来
      awk 'NR==1{next} /^set -uo pipefail$/{exit} {sub(/^# ?/,""); print}' "$0"
      exit 0 ;;
    *) echo "未知参数：${1}（用 --help 看用法）" >&2; exit 2 ;;
  esac
  shift
done

DEST="$DEST_DIR/${APP_NAME}.app"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"
BIN="$DEST/Contents/MacOS/Electron"

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s ==\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf '\n❌ %s\n' "$*" >&2; exit 1; }

# ---- 0. 检查源 .app ----
step "0/5 检查安装包"
[ -d "$APP_SRC" ] || die "找不到要安装的 app：$APP_SRC
  先跑：./build-app.sh（或 --app=<你的.app> 指定）"
[ -x "$APP_SRC/Contents/MacOS/Electron" ] || die "这个 app 不完整（缺可执行文件）：$APP_SRC"
[ -f "$APP_SRC/Contents/Info.plist" ] || die "这个 app 不完整（缺 Info.plist）：$APP_SRC"

SRC_VER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_SRC/Contents/Info.plist" 2>/dev/null || echo '?')"
SRC_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_SRC/Contents/Info.plist" 2>/dev/null || echo '?')"
SRC_SIZE="$(du -sh "$APP_SRC" | awk '{print $1}')"
ok "源包：${APP_SRC}（${SRC_SIZE}，版本 ${SRC_VER}，标识 ${SRC_ID}）"
[ "$SRC_ID" = "$LABEL" ] || warn "源包 bundle id 是 ${SRC_ID}，与登录自启 Label（${LABEL}）不一致，请先跑 ./build-app.sh 重打"

SRC_AUTH="$(codesign -dv --verbose=4 "$APP_SRC" 2>&1 | sed -n 's/^Authority=//p' | head -1)"
if codesign --verify --deep --strict "$APP_SRC" >/dev/null 2>&1; then
  ok "签名校验通过（Authority=${SRC_AUTH:-?}）"
else
  warn "签名校验未通过（in-place 可能受 iCloud 扩展属性干扰）；建议先跑 ./build-app.sh 重签"
fi

# ---- dry-run：只打印计划，绝不改文件 ----
if [ "$DRY" -eq 1 ]; then
  step "dry-run：以下是将要执行的计划（本次不复制、不写 plist、不启动）"
  say "  源包：      ${APP_SRC}（${SRC_SIZE}，版本 ${SRC_VER}，标识 ${SRC_ID}）"
  if [ -d "$DEST" ]; then
    say "  目标：      $DEST （已存在，会先删旧版再复制）"
  else
    say "  目标：      $DEST （不存在，会新建）"
  fi
  say "  应用目录：  $DEST_DIR $( [ -d "$DEST_DIR" ] && echo '（已存在）' || echo '（将创建）' )"
  if [ "$AUTOSTART" -eq 1 ]; then
    if [ -f "$PLIST" ]; then
      say "  登录自启：  会覆盖已有 plist：$PLIST"
    else
      say "  登录自启：  会新写 plist：$PLIST"
    fi
    say "              内容：Label=$LABEL / RunAtLoad=true / KeepAlive=true / LimitLoadToSessionType=Aqua"
    say "              ProgramArguments=[$BIN, --autostart]（launchd 直启 App，不写 ELECTRON_RUN_AS_NODE）"
    if [ "$NO_START" -eq 1 ]; then
      say "  launchd：   按 --no-start，只写文件不加载（下次登录才起）"
    else
      say "  launchd：   会 launchctl bootout（若有旧任务）→ bootstrap 并立刻启动"
    fi
  else
    say "  登录自启：  按 --no-autostart，不写 plist（若已有旧 plist 会被删掉）"
  fi
  say "  日志目录：  ${LOG_DIR}（将创建）"
  say "  遗留清理：  $( [ -f "$LEGACY_WRAPPER" ] && echo "会删旧版 DSH 载体守护壳 $LEGACY_WRAPPER" || echo '无旧 DSH 载体守护壳' )；$( [ -f "$LEGACY_PLIST" ] && echo "会删旧世代 bundle id plist" || echo '无旧世代 bundle id plist' )"
  say "  配置迁移：  $( [ -f "$HOME/.dsh/pet-balance-panel/config.json" ] && [ ! -f "$HOME/.dsh/glutton-balance/config.json" ] && echo "首次启动会把旧配置目录迁到 ~/.dsh/glutton-balance（旧目录保留）" || echo '无需迁移（新目录已有配置，或旧目录不存在）' )"
  say "  运行实例：  $( pgrep -f "$BIN" >/dev/null 2>&1 && echo '有旧实例，会先温和退出/兜底结束' || echo '无旧实例' )"
  say "  系统权限：  不碰（屏幕录制要老板自己在「系统设置 → 隐私与安全性」给「饭桶余额」点一次允许）"
  say ""
  say "  （dry-run 结束：以上都没实际执行）"
  exit 0
fi

# ---- 1. 停掉旧实例 ----
step "1/5 停止旧实例（如果有）"
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
  ok "已从 launchd 卸载旧自启任务"
else
  ok "旧自启任务不存在（正常，首次安装就是这样）"
fi
if launchctl print "$DOMAIN/$LEGACY_LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN/$LEGACY_LABEL" >/dev/null 2>&1 || true
  ok "已卸载旧 bundle id 的自启任务（${LEGACY_LABEL}）"
fi

# 旧世代 DSH 载体守护壳（若还在跑）：先收掉，避免它再拉起旧显示窗
if pgrep -f "$LEGACY_WRAPPER" >/dev/null 2>&1; then
  pkill -f "$LEGACY_WRAPPER" >/dev/null 2>&1 || true
  sleep 0.5
  ok "已结束旧版 DSH 载体守护壳进程"
fi

# 用主程序自己的 --quit（单实例锁）温和退出；不行再按路径精确结束
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
    warn "旧实例没自己退，按路径精确结束它"
    pkill -f "$DEST/Contents/MacOS/Electron" >/dev/null 2>&1 || true
    sleep 1
  fi
  ok "旧实例已结束"
else
  ok "没有正在运行的旧实例"
fi

# ---- 2. 复制到 ~/Applications ----
step "2/5 复制到应用目录"
mkdir -p "$DEST_DIR" || die "建不了目录：$DEST_DIR"
if [ -e "$DEST" ]; then
  rm -rf "$DEST" || die "删不掉旧版本：${DEST}（是不是正在运行？）"
fi
ditto "$APP_SRC" "$DEST" || die "复制 app 失败"
ok "已安装：$DEST"

[ -x "$DEST/Contents/MacOS/Electron" ] || die "安装后缺可执行文件，复制可能不完整"
plutil -lint "$DEST/Contents/Info.plist" >/dev/null 2>&1 || warn "安装后 Info.plist 校验异常"
if codesign --verify --deep --strict "$DEST" >/dev/null 2>&1; then
  ok "安装后签名校验通过（--verify --deep --strict）"
else
  warn "安装后签名校验未通过（本机通常仍能跑；正式分发需要签名+公证）"
fi

# 日志目录（launchd 的 stdout/stderr 落这里；主程序自己的 panel.log 在 ~/.dsh/glutton-balance/）
mkdir -p "$LOG_DIR"

# ---- 3. 登录自启（LaunchAgent 直启 App）----
step "3/5 登录自启"
if [ "$AUTOSTART" -eq 0 ]; then
  ok "--no-autostart：只装 app，不写自启（下次登录不会自动起）"
  # 若之前装过自启，这次按用户意图清掉（含旧世代遗留物，避免留半套自启）
  if [ -f "$PLIST" ]; then
    rm -f "$PLIST"
    ok "已删除旧自启 plist（${PLIST}）"
  fi
  if [ -f "$LEGACY_WRAPPER" ]; then
    rm -f "$LEGACY_WRAPPER"
    ok "已删除旧版 DSH 载体守护壳（${LEGACY_WRAPPER}）"
  fi
  if [ -f "$LEGACY_PLIST" ]; then
    rm -f "$LEGACY_PLIST"
    ok "已删除旧 bundle id plist（${LEGACY_PLIST}）"
  fi
else
  mkdir -p "$(dirname "$PLIST")"
  # 旧世代遗留：DSH 载体守护壳（2026-11-01 第 11 轮起已下线，直启 App 不再需要）
  if [ -f "$LEGACY_WRAPPER" ]; then
    rm -f "$LEGACY_WRAPPER"
    ok "已清理旧版 DSH 载体守护壳：$LEGACY_WRAPPER（新方案直启 App，不再需要）"
  fi
  if [ -f "$LEGACY_PLIST" ]; then
    rm -f "$LEGACY_PLIST"
    ok "已清理旧 bundle id plist：$LEGACY_PLIST"
  fi

  TMP_PLIST="$(mktemp /tmp/pbp-launchagent.XXXXXX.plist)"
  cat > "$TMP_PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <!-- 2026-11-01 起：launchd 直启证书签名 App（不再用 DSH 载体继承屏幕录制授权）。
       显示窗自己持有屏幕录制授权；ProgramArguments 绝不写 ELECTRON_RUN_AS_NODE。 -->
  <key>ProgramArguments</key>
  <array>
    <string>${BIN}</string>
    <string>--autostart</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/launch.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/launch.err.log</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
PLIST_EOF
  plutil -lint "$TMP_PLIST" >/dev/null 2>&1 || { rm -f "$TMP_PLIST"; die "生成的 LaunchAgent plist 不合法"; }
  # 自检：直启 App + 不写 ELECTRON_RUN_AS_NODE + 五个关键项齐全
  SELF_OK=1
  grep -qF "$BIN" "$TMP_PLIST" || SELF_OK=0
  grep -qF -- '--autostart' "$TMP_PLIST" || SELF_OK=0
  grep -q 'ELECTRON_RUN_AS_NODE' "$TMP_PLIST" && SELF_OK=0
  grep -qF '<key>KeepAlive</key>' "$TMP_PLIST" || SELF_OK=0
  grep -qF '<key>RunAtLoad</key>' "$TMP_PLIST" || SELF_OK=0
  grep -qF '<string>Aqua</string>' "$TMP_PLIST" || SELF_OK=0
  grep -qF '<string>Interactive</string>' "$TMP_PLIST" || SELF_OK=0
  grep -qF '<key>ThrottleInterval</key>' "$TMP_PLIST" || SELF_OK=0
  if [ "$SELF_OK" -ne 1 ]; then
    rm -f "$TMP_PLIST"
    die "自启 plist 自检失败（应为 launchd 直启 App：ProgramArguments=[$BIN, --autostart]，无 ELECTRON_RUN_AS_NODE）"
  fi
  mv -f "$TMP_PLIST" "$PLIST" || die "写入自启 plist 失败：$PLIST"
  chmod 644 "$PLIST"
  ok "已写登录自启：$PLIST（launchd 直启 App + KeepAlive=true）"

  if [ "$NO_START" -eq 1 ]; then
    ok "--no-start：已配置，但这次不加载启动（下次登录生效）"
  else
    if launchctl bootstrap "$DOMAIN" "$PLIST" >/dev/null 2>&1; then
      ok "已加载到 launchd（RunAtLoad=true，已自动启动）"
    else
      warn "launchctl bootstrap 失败（可能不在图形登录会话里）。自启文件已写好，下次登录仍会生效"
      warn "  手动加载：launchctl bootstrap $DOMAIN \"$PLIST\""
    fi
    sleep 1
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      ok "launchd 里已存在任务：$LABEL"
      launchctl kickstart "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    fi
  fi
fi

# ---- 4. 等进程起来 + 自检 ----
step "4/5 启动自检"
PID=""
if [ "$AUTOSTART" -eq 1 ] && [ "$NO_START" -eq 0 ]; then
  i=0
  while [ "$i" -lt 20 ]; do
    PID="$(pgrep -f "$DEST/Contents/MacOS/Electron" | head -n 1)"
    [ -n "$PID" ] && break
    sleep 0.3
    i=$((i + 1))
  done
  if [ -n "$PID" ]; then
    PPID_NUM="$(ps -o ppid= -p "$PID" 2>/dev/null | tr -d ' ')"
    ok "饭桶余额已在运行（pid ${PID}，PPID=${PPID_NUM:-?}）"
    [ "${PPID_NUM:-}" = "1" ] && ok "确认由 launchd 直启（PPID=1，不依赖 DeepSeek Harness）" || warn "PPID=${PPID_NUM:-?}（不是 1；若刚 bootstrap 可能还没稳定）"
  else
    warn "还没看到进程；稍等或在图形界面里看菜单栏图标/权限引导窗"
  fi
else
  ok "未自动启动（按参数要求）"
fi

if [ -f "$LOG_DIR/launch.err.log" ] && [ -s "$LOG_DIR/launch.err.log" ]; then
  warn "launchd 错误日志有内容：$LOG_DIR/launch.err.log（最后 3 行如下）"
  tail -n 3 "$LOG_DIR/launch.err.log" | sed 's/^/      /' >&2
fi

# ---- 5. 人话说明 ----
step "5/5 完成"
say ""
say "✅ 装好了"
say "   程序位置：$DEST"
say "   登录自启：$( [ "$AUTOSTART" -eq 1 ] && echo '已开启' || echo '未开启（--no-autostart）' )"
say "   自启方式：launchd 直启 App（com.gluttonbalance.panel.plist；KeepAlive=true，退出后自动拉起）"
say "   运行日志：$LOG_DIR/launch.log（launchd 输出）"
say "            ~/.dsh/glutton-balance/panel.log（程序自己的运行日志；首次启动自动从旧目录迁移配置）"
say ""
say "第一次使用（重要）："
say "   1. 程序需要「屏幕录制」权限（用来找 Coopanion 桌宠位置）。首次启动会弹权限引导小窗，"
say "      按引导去「系统设置 → 隐私与安全性 → 屏幕录制」给「饭桶余额」点一次允许（只需一次，"
say "      以后重新打包/升级不会再问——本机自签证书 + 同一 bundle id，签名身份不变）。"
say "   2. 辅助功能 = 可选（本版不用）。"
say "   3. 请老板自己点「允许」，不要替老板点、不要绕过系统弹窗（详见 build/PERMISSIONS.md）。"
say "   4. 允许后从菜单栏小盆图标退出再开一次（屏幕录制必须重启进程才生效）。"
say ""
say "常用命令："
say "   停止运行：  env -u ELECTRON_RUN_AS_NODE \"$BIN\" --quit"
say "   看自启状态：launchctl print $DOMAIN/$LABEL"
say "   重启自启：  launchctl kickstart -k $DOMAIN/$LABEL"
say "   一键更新（开发用）：./dev-install.sh（打包+备份+安装+重启+冒烟）"
say "   卸载：      \"$SCRIPT_DIR/uninstall.sh\""
say ""
say "签名说明：本 app 用本机自签证书 \"Maizi Local Code Signing\" 签名（不是 ad-hoc），没有 Apple 公证。"
say "  本机构建、本机安装不会拦；如果从别的机器拷来，第一次打开要在「系统设置 → 隐私与安全性」里点「仍要打开」。"
