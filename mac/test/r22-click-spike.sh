#!/bin/bash
# r22-click-spike.sh — 第 22 轮甲路：「点击/菜单/悬停/拎起」不再放大饭桶 + 真实改缩放仍按比例重排
#
# 加固版（v2）：main.js 增加「大变化 episode 期间光标在桌宠身上（≤80pt）→ 重定基准计时暂停」。
# 本脚本用隔离实例（拷贝 app-mac 到 /tmp，桩 native/petprobe 按 125ms 喂脚本化采样，真实 main.js 全链路）
# + 真实光标 WARP（screen.getCursorScreenPoint 可读、无需辅助功能权限）验证：
#   A-fixed   点击/右击菜单态尖刺 4 轮（光标在桌宠身上）           → 0 放大 / 0 apply / 0 baseline
#   A-old     同一序列喂改前基线 main.js（对照组）                  → 至少 1 次放大（证明样本有效）
#   B-fixed   真实改缩放 86.5→170（光标远离桌宠）                  → 恰 1 次按比例 resize
#   C-fixed   菜单/交互态驻留 20s + 拎起静止 12s（光标在桌宠身上）  → 0 放大 / 0 apply / 0 baseline
#   C-old     同一「驻留」序列喂改前基线 main.js（对照组）          → 至少 1 次放大
# 退出码：0=全部 PASS；1=有 FAIL；9=缺依赖（Electron）
#
# 安全约定（2026-11-05 P0 事故后加固）：
#   · 本脚本**只允许前台 WARP**（wait_prog_keep 内同步调用），**禁止** `( while ... ) &` 这类后台光标循环；
#   · 万不得已要后台，必须登记 PID 到 CLEANUP_PIDS，并依赖下方 cleanup() trap（EXIT/INT/TERM/HUP）清理；
#   · 退出/中断前统一 stop_app + 杀掉登记的后台 PID，禁止把 WARP 循环留给用户会话。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$(cd "$HERE/.." && pwd)"
WS="$(cd "$APP_SRC/.." && pwd)"
T=/tmp/r22-jia
OUT="${1:-$WS/evidence/round22-mac/click-spike-hardened}"
EL=""
for c in "$APP_SRC/tools/Electron.app/Contents/MacOS/Electron" "$WS/app-mac/tools/Electron.app/Contents/MacOS/Electron"; do
  [ -x "$c" ] && { EL="$c"; break; }
done
[ -n "$EL" ] || { echo "!! 找不到 Electron 测试二进制（app-mac/tools/Electron.app）"; exit 9; }
BASELINE_PRE="$WS/evidence/round22-mac/main-before-round22.js"      # 第22轮修复前：点击尖刺会放大（A-old 对照）
BASELINE_R22="$WS/evidence/round22-mac/main-before-hardening.js"    # 第22轮修复后/加固前：点击不放大，但长驻/拎起 >8s 会放大（C-old 对照）
APP="$T/testapp"; CFG="$T/cfg.json"
mkdir -p "$T" "$OUT"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "PASS  $*"; }
bad(){ FAIL=$((FAIL+1)); echo "FAIL  $*"; }
# 光标工具：优先用与主程序同口径的 CGWarpMouseCursorPosition（不需要辅助功能授权）
WARP=""
for c in /tmp/r22-live-tools/warpmouse "$WS/.tmp/r22-warpmouse"; do [ -x "$c" ] && { WARP="$c"; break; }; done
if [ -z "$WARP" ]; then
  WARP="$T/warpmouse"
  cat > "$T/warpmouse.swift" <<'SWIFT'
import CoreGraphics
import Foundation
let x = Double(CommandLine.arguments[1])!, y = Double(CommandLine.arguments[2])!
CGWarpMouseCursorPosition(CGPoint(x: x, y: y))
CGAssociateMouseAndMouseCursorPosition(1)
SWIFT
  xcrun swiftc -O -o "$WARP" "$T/warpmouse.swift" 2>/dev/null || { echo "!! 无法编译 warpmouse"; exit 9; }
fi
echo "warpmouse=$WARP"

# ---------------- 采样序列（每行：charW [bodyCenterX headY feetY]；缺省 695 740 880） ----------------
seq_click(){ # 点击/右击菜单态尖刺 4 轮（与真机实证序列同口径）
  local i e
  for i in $(seq 1 40); do echo "86.5 695 740 880"; done
  for e in 1 2 3 4; do
    printf '130 695 740 880\n274.5 695 740 880\n264 695 740 880\n364.5 695 740 880\n345 695 740 880\n313 695 740 880\n'
    for i in $(seq 1 27); do echo "102.5 695 740 880"; done
    for i in $(seq 1 10); do echo "86.5 695 740 880"; done
  done
  for i in $(seq 1 20); do echo "86.5 695 740 880"; done
}
seq_realscale(){ # 真实改缩放：86.5→170（位置不动、脚锚定、光标远离）
  local i
  for i in $(seq 1 40); do echo "86.5 695 740 880"; done
  for i in $(seq 1 116); do echo "170 695 740 880"; done
}
seq_interact(){ # a) 菜单/悬停态驻留 20s  b) 拎起静止 12s（光标都在桌宠身上）
  local i
  for i in $(seq 1 40); do echo "86.5 695 740 880"; done
  for i in $(seq 1 160); do echo "134 695 740 880"; done           # a) 20s 驻留
  for i in $(seq 1 20); do echo "86.5 695 740 880"; done          # 回稳
  for i in $(seq 1 96); do echo "150 664 725 893.5"; done         # b) 拎起（x -31pt、head 抬 15）静止 12s
  for i in $(seq 1 20); do echo "86.5 695 740 880"; done          # 回稳
}

setup_testapp(){ # <main.js 覆写源|空>
  rm -rf "$APP"; mkdir -p "$APP"
  ( cd "$APP_SRC" && tar cf - --exclude=./build --exclude=./tools . ) | ( cd "$APP" && tar xf - )
  if [ -n "${1:-}" ]; then cp "$1" "$APP/main.js" || exit 1; fi
  cat > "$APP/native/petprobe" <<'STUB'
#!/bin/bash
# [r22 加固版测试桩] 每行 = "charW [cx headY feetY]"，每 125ms 输出一条
SEQ="${PBP_TEST_CHARW_SEQ:?}"
PROG="${PBP_TEST_PROGRESS:?}"
V=()
while IFS= read -r line; do V+=("$line"); done < "$SEQ"
n=${#V[@]}
[ "$n" -ge 1 ] || V=("86.5 695 740 880")
i=0
while true; do
  line="${V[$i]}"
  cw= cx= hy= fy=
  read -r cw cx hy fy <<< "$line"
  [ -z "$cw" ] && cw=86.5
  [ -z "$cx" ] && cx=695
  [ -z "$hy" ] && hy=740
  [ -z "$fy" ] && fy=880
  echo "$i" > "$PROG" 2>/dev/null
  echo "{\"ok\":true,\"wid\":999001,\"winX\":620,\"winY\":700,\"winW\":150,\"winH\":160,\"scale\":2,\"feetPt\":$fy,\"headPt\":$hy,\"centerPt\":$cx,\"bodyCenterPt\":$cx,\"charWpt\":$cw,\"charHpt\":140,\"captureMs\":5,\"scanMs\":2}"
  i=$((i+1)); [ "$i" -ge "$n" ] && i=$((n-1))
  sleep 0.125
done
STUB
  chmod +x "$APP/native/petprobe"
  python3 - "$APP/main.js" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding='utf-8')
a = "    if (!checkScreenPermission()) {\n      showGuideWindow('no-screen-permission');"
b = "    if (false) { // [r22 测试副本] 跳过权限引导窗（桩 petprobe 不需要系统权限）\n      showGuideWindow('no-screen-permission');"
assert s.count(a) == 1, 'patch1 missing'
s = s.replace(a, b)
c = "  if (checkScreenPermission()) {\n    locator.start();"
d = "  if (true) { // [r22 测试副本] 桩 petprobe 无需系统权限\n    locator.start();"
assert s.count(c) == 1, 'patch2 missing'
s = s.replace(c, d)
p.write_text(s, encoding='utf-8')
PY
  diff -u "${1:-$APP_SRC/main.js}" "$APP/main.js" > "$OUT/testapp-only-diff.txt" 2>&1 || true
  cat > "$CFG" <<'JSON'
{
  "version": 1, "enabled": true, "clickThrough": true, "refreshSeq": 1,
  "hotkey": { "enabled": false, "combo": "Ctrl+Alt+Shift+R" },
  "position": { "mode": "under-feet", "bottomGap": 8, "offsetX": 0, "offsetY": 0, "zOrder": "topmost", "petPort": 7797, "clampMargin": 8, "monitorFollow": true },
  "capsule": { "width": 200, "height": 30, "overlap": 6, "maxProviders": 9 },
  "liveFollow": { "detectMs": 125, "smooth": true },
  "petLift": { "enabled": false },
  "display": { "style": "ricebowl", "bowlStyle": "porcelain", "labelStyle": "L3", "wear": "head", "nineLayout": "pyramid", "compactAfter": 5, "refYuan": 100, "wheels": false, "petScaleRef": 1.05, "graphicsMin": 0.95, "graphicsMax": 2, "logo": false, "logoStyle": "deepseek" },
  "theme": { "follow": false, "port": 17788, "statePort": 7797, "force": "", "pollMs": 3000 },
  "interaction": { "expandOnClick": false, "shake": { "enabled": false } },
  "providers": [
    { "id": "rice1", "name": "大白饭", "type": "rice", "threshold": null, "intervalSec": 60, "enabled": true },
    { "id": "rice2", "name": "大白饭", "type": "rice", "threshold": null, "intervalSec": 60, "enabled": true },
    { "id": "rice3", "name": "大白饭", "type": "rice", "threshold": null, "intervalSec": 60, "enabled": true }
  ]
}
JSON
}

APP_PID=""
stop_app(){
  if [ -n "${APP_PID:-}" ]; then
    kill -TERM "$APP_PID" 2>/dev/null
    for _ in $(seq 1 60); do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$APP_PID" 2>/dev/null
  fi
  APP_PID=""
}
# P0 事故后加固：退出/中断统一清理（test App + 登记的后台作业；本脚本正常路径无后台 WARP 循环）
CLEANUP_PIDS=()
cleanup(){
  stop_app
  local p
  for p in "${CLEANUP_PIDS[@]:-}"; do
    [ -n "$p" ] && kill -TERM "$p" 2>/dev/null
  done
  for p in "${CLEANUP_PIDS[@]:-}"; do
    [ -n "$p" ] && kill -KILL "$p" 2>/dev/null
  done
  CLEANUP_PIDS=()
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM HUP

start_app(){ # <tag> <seq 文件>
  LOG="$T/panel-$1.log"; PROG="$T/prog-$1"; TRACE="$T/trace-$1.log"
  PANEL_DIR="$T/panelcfg-$1"; UD="$T/ud-$1"
  mkdir -p "$PANEL_DIR" "$UD"; : > "$LOG"; echo 0 > "$PROG"; : > "$TRACE"
  env -u ELECTRON_RUN_AS_NODE PBP_TEST_CHARW_SEQ="$2" PBP_TEST_PROGRESS="$PROG" \
    GLUTTONBALANCE_PANEL_DIR="$PANEL_DIR" GLUTTONBALANCE_PANEL_LOG="$LOG" \
    "$EL" "$APP" --user-data-dir="$UD" --config "$CFG" > "$OUT/stdout-$1.log" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 200); do [ -s "$LOG" ] && break; sleep 0.1; done
}
prog(){ local v; v=$(cat "$PROG" 2>/dev/null); echo "${v:-0}"; }
wait_prog(){ # <目标序号> <超时ms>
  local target="$1" to="${2:-60000}" t0; t0=$(date +%s)
  while :; do
    [ "$(prog)" -ge "$target" ] && return 0
    [ $(( $(date +%s) - t0 )) -ge $(( to / 1000 )) ] && return 1
    sleep 0.1
  done
}
has(){ grep -qE "$1" "$LOG" 2>/dev/null; }
cnt(){ local n; n=$(grep -cE "$1" "$LOG" 2>/dev/null || true); echo "${n:-0}"; }
warp(){ "$WARP" "$1" "$2" >/dev/null 2>&1 || true; }   # 桩桌宠本体中心 ≈ (695,810)；真实缩放时移远
# 等进度期间持续把光标钉在指定位置（真人移动鼠标会覆盖 CGWarp，必须每 0.25s 重钉）
wait_prog_keep(){ # <目标序号> <超时ms> <x> <y>
  local target="$1" to="${2:-60000}" x="$3" y="$4" t0; t0=$(date +%s)
  while :; do
    [ "$(prog)" -ge "$target" ] && return 0
    [ $(( $(date +%s) - t0 )) -ge $(( to / 1000 )) ] && return 1
    warp "$x" "$y"
    sleep 0.25
  done
}
warps(){ warp 695 810; }   # 光标在桌宠身上
warpf(){ warp 300 300; }   # 光标远离桌宠（真实改缩放场景）
growth_resizes(){ # <起始行号>
  python3 - "$LOG" "${1:-0}" <<'PY'
import re, sys
log, start = sys.argv[1], int(sys.argv[2] or 0)
try: lines = open(log, encoding='utf-8', errors='ignore').read().splitlines()
except Exception: lines = []
out = []
for i, line in enumerate(lines):
    if i < start: continue
    m = re.search(r'panel resize (\d+)x(\d+) -> (\d+)x(\d+)', line)
    if not m: continue
    ow, oh, nw, nh = map(int, m.groups())
    if nw * nh > ow * oh * 1.03:
        out.append((nw, nh, line))
print(len(out))
for w, h, line in out: print('%dx%d %s' % (w, h, line))
PY
}
resizes_all(){ python3 - "$LOG" "${1:-0}" <<'PY'
import re, sys
log, start = sys.argv[1], int(sys.argv[2] or 0)
try: lines = open(log, encoding='utf-8', errors='ignore').read().splitlines()
except Exception: lines = []
for i, line in enumerate(lines):
    if i < start: continue
    if re.search(r'panel resize \d+x\d+ -> \d+x\d+', line): print(line)
PY
}
newlines(){ tail -n +$(( ${1:-0} + 1 )) "$LOG" 2>/dev/null; }
last_log_line(){ tail -1 "$LOG" 2>/dev/null; }

echo "== 第 22 轮甲路 · 点击/菜单/拎起 加固仿真（隔离实例+桩 petprobe+真实光标 WARP）$(date -Iseconds) =="
echo "Electron=$EL"
echo "输出=$OUT"

# ================= A-fixed：点击/右击尖刺（光标在桌宠身上）→ 0 放大 =================
setup_testapp
seq_click > "$T/seq-click.txt"
start_app afixed "$T/seq-click.txt"
if wait_prog 40 30000; then
  sleep 0.4; MARK=$(wc -l < "$LOG" | tr -d ' '); warps
  ok "A-fixed 前置：面板启动 + 5s 基线（标记行 ${MARK}；光标已 WARP 到桌宠身上）"
  warps
  if wait_prog_keep 225 60000 695 810; then ok "A-fixed：4 轮点击/右击尖刺回放完成（光标全程钉在桌宠身上）"; else bad "A-fixed：序列回放超时"; fi
  sleep 1.0
  A_GROW=$(growth_resizes "$MARK" | head -1); A_ACC=$(newlines "$MARK" | grep -c 'baseline accepted' || true)
  A_APPLY=$(newlines "$MARK" | grep -c 'scale apply' || true); A_PAUSE=$(newlines "$MARK" | grep -c 'paused cursor-near' || true)
  [ "$A_GROW" = "0" ] && ok "A-fixed：点击尖刺期间 0 次放大 resize" || bad "A-fixed：出现 ${A_GROW} 次放大 resize"
  [ "${A_ACC:-0}" = "0" ] && ok "A-fixed：0 次重定基准（光标邻近计时暂停生效）" || bad "A-fixed：仍有 ${A_ACC} 次重定基准"
  [ "${A_APPLY:-0}" = "0" ] && ok "A-fixed：0 条 scale apply" || bad "A-fixed：${A_APPLY} 条 scale apply"
  [ "${A_PAUSE:-0}" -ge 1 ] && ok "A-fixed 有效性：出现「paused cursor-near」${A_PAUSE} 次（光标判据确实命中）" || bad "A-fixed 有效性：没有 paused cursor-near（光标判据未命中）"
else bad "A-fixed：启动/基线超时"; fi
stop_app; cp "$LOG" "$OUT/A-fixed-panel.log" 2>/dev/null || true

# ================= A-old：改前基线 main.js + 同序列 → 至少 1 次放大（对照） =================
if [ -f "$BASELINE_PRE" ]; then
  setup_testapp "$BASELINE_PRE"; start_app aold "$T/seq-click.txt"
  if wait_prog 40 30000; then
    sleep 0.4; MARK=$(wc -l < "$LOG" | tr -d ' '); warps
    wait_prog 225 60000 || true; sleep 1.0
    O_GROW=$(growth_resizes "$MARK" | head -1)
    [ "${O_GROW:-0}" -ge 1 ] && ok "A-old（对照）：改前基线复现放大 ${O_GROW} 次 → 样本有效、加固确实堵住" || bad "A-old（对照）：改前基线 0 次放大（样本无效）"
  else bad "A-old：启动/基线超时"; fi
  stop_app; cp "$LOG" "$OUT/A-old-panel.log" 2>/dev/null || true
else bad "A-old：缺少改前基线 $BASELINE_PRE"; fi

# ================= B-fixed：真实改缩放（光标远离）→ 恰 1 次按比例 resize =================
setup_testapp
seq_realscale > "$T/seq-realscale.txt"
warpf; start_app bfixed "$T/seq-realscale.txt"; warpf
if wait_prog 40 30000; then
  sleep 0.4; MARK=$(wc -l < "$LOG" | tr -d ' '); warpf
  ok "B-fixed 前置：完成 5s 基线（标记行 ${MARK}；光标远离桌宠）"
  wait_prog_keep 150 70000 300 300 || true; sleep 1.0
  B_ACC=$(newlines "$MARK" | grep 'baseline accepted' | tail -1)
  B_RES=$(newlines "$MARK" | grep -c 'panel resize ' || true)
  if [ -n "$B_ACC" ]; then
    ok "B-fixed：真实改缩放仍重定基准 → $(echo "$B_ACC" | sed 's/^[^ ]* //')"
    B_STABLE=$(echo "$B_ACC" | sed -n 's/.*stableMs=\([0-9]*\).*/\1/p')
    [ -n "$B_STABLE" ] && [ "$B_STABLE" -ge 7900 ] && ok "B-fixed：≥8s 长稳定门控生效（stableMs=${B_STABLE}）" || bad "B-fixed：稳定时长异常（${B_STABLE:-空}）"
    echo "$B_ACC" | grep -q 'charW=17[0-9]\.' && ok "B-fixed：基准按真实角色宽 170 重定" || bad "B-fixed：基准未到 170"
  else bad "B-fixed：真实改缩放未重定基准（被冻死=回退匹配比例）"; fi
  [ "${B_RES:-0}" = "1" ] && ok "B-fixed：恰 1 次 panel resize（按比例）" || bad "B-fixed：panel resize=${B_RES}（期望 1）"
  newlines "$MARK" | grep -E 'panel resize ' | tail -2 | sed 's/^/   INFO /'
else bad "B-fixed：启动/基线超时"; fi
stop_app; cp "$LOG" "$OUT/B-fixed-panel.log" 2>/dev/null || true

# ================= C-fixed：菜单态驻留 20s + 拎起静止 12s（光标在桌宠身上）→ 0 放大 =================
setup_testapp
seq_interact > "$T/seq-interact.txt"
start_app cfixed "$T/seq-interact.txt"
if wait_prog 40 30000; then
  sleep 0.4; MARK=$(wc -l < "$LOG" | tr -d ' '); warps
  ok "C-fixed 前置：完成基线（标记行 ${MARK}；光标在桌宠身上）"
  wait_prog_keep 219 90000 695 810 || true            # 菜单驻留段：光标钉在桌宠身上
  wait_prog_keep 330 90000 664 809 || true; warpf     # 拎起段：光标跟到拎起后的本体中心
  wait_prog_keep 336 15000 664 809 || true
  sleep 1.0
  C_GROW=$(growth_resizes "$MARK" | head -1); C_ACC=$(newlines "$MARK" | grep -c 'baseline accepted' || true)
  C_APPLY=$(newlines "$MARK" | grep -c 'scale apply' || true); C_PAUSE=$(newlines "$MARK" | grep -c 'paused cursor-near' || true)
  C_CW10=$(newlines "$MARK" | grep -c 'charW=134.0' || true)
  [ "$C_GROW" = "0" ] && ok "C-fixed：菜单驻留 20s + 拎起静止 12s → 0 次放大 resize" || { bad "C-fixed：出现 ${C_GROW} 次放大 resize"; growth_resizes "$MARK" | tail -n +2 | head -3 | sed 's/^/     /'; }
  [ "${C_ACC:-0}" = "0" ] && ok "C-fixed：0 次重定基准（长驻交互/拎起期间计时一直暂停）" || { bad "C-fixed：仍有 ${C_ACC} 次重定基准"; newlines "$MARK" | grep 'baseline accepted' | head -3 | sed 's/^/     /'; }
  [ "${C_APPLY:-0}" = "0" ] && ok "C-fixed：0 条 scale apply" || bad "C-fixed：${C_APPLY} 条 scale apply"
  [ "${C_PAUSE:-0}" -ge 2 ] && ok "C-fixed 有效性：paused cursor-near × ${C_PAUSE}（菜单段+拎起段各≥1）" || bad "C-fixed 有效性：paused cursor-near=${C_PAUSE}（期望 ≥2）"
  [ "${C_CW10:-0}" -ge 1 ] && ok "C-fixed 有效性：日志出现驻留段 charW=134.0（菜单态确实回放）" || bad "C-fixed 有效性：未见 charW=134.0"
else bad "C-fixed：启动/基线超时"; fi
stop_app; cp "$LOG" "$OUT/C-fixed-panel.log" 2>/dev/null || true

# ================= C-old：改前基线 main.js + 同一「驻留/拎起」序列 → 至少 1 次放大（对照） =================
if [ -f "$BASELINE_R22" ]; then
  setup_testapp "$BASELINE_R22"; warpf; start_app cold "$T/seq-interact.txt"; warpf
  if wait_prog 40 30000; then
    sleep 0.4; MARK=$(wc -l < "$LOG" | tr -d ' ')
    wait_prog 330 100000 || true; sleep 1.0
    O2_GROW=$(growth_resizes "$MARK" | head -1)
    [ "${O2_GROW:-0}" -ge 1 ] && ok "C-old（对照）：改前基线在「驻留/拎起」序列下放大 ${O2_GROW} 次 → 加固确实堵住" || bad "C-old（对照）：改前基线 0 次放大（样本无效）"
  else bad "C-old：启动/基线超时"; fi
  stop_app; cp "$LOG" "$OUT/C-old-panel.log" 2>/dev/null || true
else bad "C-old：缺少加固前基线 $BASELINE_R22"; fi

echo
echo "== 结果：PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -gt 0 ] && exit 1
exit 0
