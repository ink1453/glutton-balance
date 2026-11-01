#!/bin/bash
# 安装「饭桶余额」：复制 app 到 ~/Applications + 写登录自启 LaunchAgent 并立刻启动
#
# 用法：
#   ./install.sh                    # 正常安装（复制 + 设登录自启 + 立刻启动）
#   ./install.sh --no-autostart     # 只装 app，不写自启（验收/临时看效果用）
#   ./install.sh --no-start         # 写自启但不马上启动（下次登录才起）
#   ./install.sh --dry-run          # 干跑：只打印计划，不复制/不写 plist/不启动
#   ./install.sh --app=<别的.app>   # 指定源 .app（默认 build/dist/饭桶余额.app）
#
# 设计：
#   · 幂等：重复跑会先停旧实例、覆盖旧文件、替换旧 plist，不重复追加
#   · 可回滚：uninstall.sh 一键反向（不删用户配置）
#   · 自启 = ~/Library/LaunchAgents/com.ricebowl.petbalancepanel.plist（RunAtLoad=true）
#     Mac 上「饭桶余额」自己的屏幕录制授权无法生效（2026-11-01 A1 真机实测：launchd 直启时
#     权限引导窗 + petprobe 无权限）。改为：ProgramArguments 指向 DSH 主程序（Node 模式），
#     由守护壳 ~/.dsh/pet-balance-panel/launch-via-dsh.mjs spawn 显示窗 → 继承 DSH 的屏幕录制授权。
#     守护壳必须常驻（launchd 在载体退出时会杀掉同进程组的显示窗，spawn 完就退会被一起收掉）。
#     plist 里 ELECTRON_RUN_AS_NODE=1 只给 DSH 载体用；守护壳 spawn 显示窗前会删掉它，显示窗按 GUI 跑。
#   · 不动系统设置、不代点权限弹窗（权限要老板自己点，见 build/PERMISSIONS.md）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP_SRC="$SCRIPT_DIR/dist/饭桶余额.app"
APP_NAME="饭桶余额"
DEST_DIR="$HOME/Applications"
LABEL="com.ricebowl.petbalancepanel"
LOG_DIR="$HOME/Library/Logs/饭桶余额"
# 自启载体（2026-11-01 A1）：DSH 主程序以 Node 模式跑守护壳，spawn 显示窗继承 DSH 的屏幕录制授权
DSH_APP="/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness"
CONFIG_DIR="$HOME/.dsh/pet-balance-panel"
WRAPPER="$CONFIG_DIR/launch-via-dsh.mjs"
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

if codesign --verify "$APP_SRC" >/dev/null 2>&1; then
  ok "签名校验通过（ad-hoc）"
else
  warn "签名校验未通过：本机可能仍能跑，但建议先跑 ./build-app.sh 重签"
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
    say "              内容：Label=$LABEL / RunAtLoad=true / ProgramArguments=[DSH 主程序(Node 模式), 守护壳 launch-via-dsh.mjs]"
    say "              载体：DSH 主程序（继承其屏幕录制授权）；守护壳常驻，负责 spawn/收尸显示窗"
    if [ -f "$WRAPPER" ]; then
      say "  载体守护壳：会覆盖已有 $WRAPPER"
    else
      say "  载体守护壳：会新写 $WRAPPER"
    fi
    if [ "$NO_START" -eq 1 ]; then
      say "  launchd：   按 --no-start，只写文件不加载（下次登录才起）"
    else
      say "  launchd：   会 launchctl bootout（若有旧任务）→ bootstrap 并立刻启动"
    fi
  else
    say "  登录自启：  按 --no-autostart，不写 plist（若已有旧 plist / DSH 载体守护壳会被删掉）"
  fi
  say "  日志目录：  ${LOG_DIR}（将创建）"
  say "  运行实例：  $( pgrep -f "$DEST/Contents/MacOS/Electron" >/dev/null 2>&1 && echo '有旧实例，会先温和退出/兜底结束' || echo '无旧实例' )"
  say "  系统权限：  不碰（屏幕录制授权由 DSH 载体继承；本机实测「饭桶余额」自身授权无法生效）"
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

# DSH 载体会随 bootout 收到 SIGTERM，守护壳会顺手把显示窗收掉；等它退，残留则按守护壳路径精确结束
i=0
while [ "$i" -lt 10 ] && pgrep -f "$WRAPPER" >/dev/null 2>&1; do
  sleep 0.2
  i=$((i + 1))
done
if pgrep -f "$WRAPPER" >/dev/null 2>&1; then
  warn "DSH 载体还在跑，按守护壳路径先 SIGTERM 收掉"
  pkill -f "$WRAPPER" >/dev/null 2>&1 || true
  sleep 0.5
  if pgrep -f "$WRAPPER" >/dev/null 2>&1; then
    pkill -9 -f "$WRAPPER" >/dev/null 2>&1 || true
    sleep 0.3
  fi
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
if codesign --verify "$DEST" >/dev/null 2>&1; then
  ok "安装后签名校验通过"
else
  warn "安装后签名校验未通过（本机通常仍能跑；正式分发需要签名+公证）"
fi

# 日志目录（launchd 的 stdout/stderr 落这里；主程序自己的 panel.log 在 ~/.dsh/pet-balance-panel/）
mkdir -p "$LOG_DIR"

# ---- 3. 登录自启（LaunchAgent）----
step "3/5 登录自启"
if [ "$AUTOSTART" -eq 0 ]; then
  ok "--no-autostart：只装 app，不写自启（下次登录不会自动起）"
  # 若之前装过自启，这次按用户意图清掉（含 DSH 载体守护壳，避免留半套自启）
  if [ -f "$PLIST" ]; then
    rm -f "$PLIST"
    ok "已删除旧自启 plist（${PLIST}）"
  fi
  if [ -f "$WRAPPER" ]; then
    rm -f "$WRAPPER"
    ok "已删除 DSH 载体守护壳（${WRAPPER}）"
  fi
else
  mkdir -p "$(dirname "$PLIST")"
  # 2026-11-01 A1：Mac 屏幕录制授权给不到「饭桶余额」自己（真机实测），改由 DSH 主程序当载体拉起。
  # 先写/更新「DSH 载体守护壳」（登录自启时由 DSH 主程序以 Node 模式执行）。
  [ -x "$DSH_APP" ] || die "找不到 DSH 主程序：$DSH_APP —— 本机自启依赖它继承屏幕录制授权（老板 2026-11-01 定的方案）"
  mkdir -p "$CONFIG_DIR"
  cat > "$WRAPPER" <<'WRAPPER_EOF'
// 饭桶余额显示窗 · 登录自启守护壳（2026-11-01 第2轮 A1）
// 由 LaunchAgent com.ricebowl.petbalancepanel 用「DeepSeek Harness」主程序以 Node 模式启动。
// 为什么这样：Mac 屏幕录制授权只认「饭桶余额」自己的签名，而本机该授权无法授予本应用；
// 用 DSH 主程序当载体，被拉起的显示窗进程继承 DSH 的屏幕录制授权（本机实测有效）。
// 作用：spawn 显示窗并常驻守护（launchd 在载体退出时会杀整个进程组，所以不能 spawn 完就退）。
import { spawn } from 'node:child_process';

const APP = '__PBP_APP_BIN__';
const stamp = () => new Date().toISOString();
const log = (s) => console.log(`${stamp()} [launch-via-dsh] ${s}`);

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;        // 显示窗必须按 GUI 应用跑，不能继承 Node 模式
delete env.ELECTRON_NO_ATTACH_CONSOLE;

log('spawn panel');
const child = spawn(APP, ['--autostart'], { env, stdio: 'ignore' });

child.on('error', (e) => {
  console.error(`${stamp()} [launch-via-dsh] spawn failed: ${e && e.message}`);
  process.exit(1);
});
child.on('exit', (code, sig) => {
  log(`panel exited code=${code} sig=${sig}`);
  process.exit(0);
});
// bootout / kickstart -k 会先发 SIGTERM：把显示窗一起收掉，避免孤儿进程
process.on('SIGTERM', () => {
  log('SIGTERM -> stop panel');
  try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 1500);
});
process.on('SIGINT', () => {
  try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
  setTimeout(() => process.exit(0), 1500);
});
WRAPPER_EOF
  # 显示窗路径不写死本机绝对路径：heredoc 里留占位符，再用 $DEST 派生的 $BIN 回填
  sed -i '' "s|__PBP_APP_BIN__|${BIN}|g" "$WRAPPER" || die "写自启守护壳失败：回填显示窗路径"
  grep -q '__PBP_APP_BIN__' "$WRAPPER" && die "自启守护壳仍留有未替换的占位符"
  chmod 644 "$WRAPPER"
  ok "已写自启守护壳：$WRAPPER"

  TMP_PLIST="$(mktemp /tmp/pbp-launchagent.XXXXXX.plist)"
  cat > "$TMP_PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <!-- 2026-11-01 第2轮 A1：Mac 上「饭桶余额」自己的屏幕录制授权无法生效（实测 launchd 直启时
       权限引导窗 + petprobe 无权限），改用 DSH 主程序以 Node 模式当载体拉起显示窗，继承 DSH 的屏幕录制授权。
       守护壳常驻（launchd 在载体退出时会杀掉同进程组的显示窗）。 -->
  <key>ProgramArguments</key>
  <array>
    <string>${DSH_APP}</string>
    <string>--expose-internals</string>
    <string>${WRAPPER}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ELECTRON_RUN_AS_NODE</key>
    <string>1</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>WorkingDirectory</key>
  <string>${CONFIG_DIR}</string>
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
  # 自检：载体 = DSH 主程序（Node 模式）+ 守护壳存在（ELECTRON_RUN_AS_NODE 只给载体用，不允许指向显示窗本体）
  if grep -q 'ELECTRON_RUN_AS_NODE' "$TMP_PLIST" && grep -q "$WRAPPER" "$TMP_PLIST" && [ -f "$WRAPPER" ] && ! grep -q '饭桶余额.app/Contents/MacOS/Electron' "$TMP_PLIST"; then
    ok "自启载体自检通过（DSH 主程序 Node 模式 + 守护壳）"
  else
    rm -f "$TMP_PLIST"
    die "自启 plist 自检失败（应为 DSH 载体 + 守护壳，不能直接指向显示窗本体）"
  fi
  mv -f "$TMP_PLIST" "$PLIST" || die "写入自启 plist 失败：$PLIST"
  chmod 644 "$PLIST"
  ok "已写登录自启：$PLIST"

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
    ok "饭桶余额已在运行（pid ${PID}）"
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
say "   自启方式：DSH 主程序当载体（Node 模式）+ 守护壳 launch-via-dsh.mjs（显示窗继承 DSH 的屏幕录制授权）"
say "   运行日志：$LOG_DIR/launch.log（launchd 输出）"
say "            ~/.dsh/pet-balance-panel/panel.log（程序自己的运行日志）"
say ""
say "第一次使用（重要）："
say "   1. 如果是「登录自启」拉起的（DSH 载体方案），屏幕录制授权直接继承 DSH，正常不需要再授权；"
say "      如果是自己从访达双击打开、程序在屏幕中间弹「权限引导」小窗，才需要按下面点一次。"
say "   2. 屏幕录制 = 必须（用来找 Coopanion 桌宠的位置）；辅助功能 = 可选（本版不用）。"
say "   3. 点引导窗里的按钮会跳到「系统设置 → 隐私与安全性」，请老板自己点「允许」，"
say "      不要替老板点，也不要绕过系统弹窗（详见 build/PERMISSIONS.md）。"
say "   4. 允许后回引导窗点「重新检测」，或者从菜单栏图标退出再开一次。"
say ""
say "常用命令："
say "   停止运行：  env -u ELECTRON_RUN_AS_NODE \"$BIN\" --quit"
say "   看自启状态：launchctl print $DOMAIN/$LABEL"
say "   重启自启：  launchctl kickstart -k gui/$(id -u)/$LABEL"
say "   卸载：      \"$SCRIPT_DIR/uninstall.sh\""
say ""
say "未签名提醒：这个 app 是本机自签（ad-hoc），没有 Apple 公证。"
say "  本机构建、本机安装不会拦；如果从别的机器拷来，第一次打开要在「系统设置 → 隐私与安全性」里点「仍要打开」。"
