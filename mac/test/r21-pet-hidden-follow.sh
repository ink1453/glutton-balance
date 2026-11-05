#!/bin/bash
# r21-pet-hidden-follow.sh — 第 21 轮甲路：桌宠「窗口被隐藏/退出」→ 显示窗（饭桶）≤1s 自动隐藏；桌宠回来 → 自动显示
#
# 做法（沿用第 11 轮 D 路的隔离实例法）：
#   把 app-mac 整棵树拷到 /tmp 下（只跳过权限引导窗的 2 行），用桩 native/petprobe 模拟
#   「桌宠窗口存在 / no-pet-window / SCK capture-error（带 wid，窗口其实还在）」三种采样，
#   跑真实 positionTick 全链路，断言 panel.log 的 hide/show 日志、时间差、窗口可见性。
#   —— 不安装、不碰已安装的「饭桶余额.app」、不碰 Coopanion、不改配置；测试实例用独立 user-data-dir。
#
# 用例：
#   T1 桌宠窗口消失 300ms 后恢复         → 不隐藏（0 条 panel hide）
#   T2 桌宠窗口持续消失                 → ≤1200ms 内出现 `panel hide reason=pet-hidden missingMs=…`
#   T3 隐藏后桌宠窗口回来               → 自动 `panel show reason=pet-detected`（窗口重新可见）
#   T4 只发 capture-error（带 wid）8s    → 不隐藏（旧 5s 兜底也不能误判；规格只需 2s，这里跑到 8s 更严）
#   T5 桌宠完全退出（no-pet-window 持续）→ 隐藏且保持隐藏、不重复 hide
#   T6 启动 10s 宽限：启动后 3s 隐藏桌宠 → 宽限内不隐藏；过了 10s 才隐藏
#
# 用法：bash r21-pet-hidden-follow.sh [输出目录]
# 退出码：0=全部 PASS；1=有 FAIL；9=缺依赖（Electron / winpos）
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_SRC="$(cd "$HERE/.." && pwd)"
WS_GUESS="$(cd "$APP_SRC/.." && pwd)"
T=/tmp/r21-jia
OUT="${1:-$T/out}"
EL=""
for c in "$APP_SRC/tools/Electron.app/Contents/MacOS/Electron" \
         "$WS_GUESS/app-mac/tools/Electron.app/Contents/MacOS/Electron"; do
  [ -x "$c" ] && { EL="$c"; break; }
done
WINPOS=""
for c in "$HERE/../../evidence/round11-A/scenarios/bin/winpos" \
         "$HERE/../../../evidence/round11-A/scenarios/bin/winpos" \
         "$WS_GUESS/evidence/round11-A/scenarios/bin/winpos"; do
  [ -x "$c" ] && { WINPOS="$(cd "$(dirname "$c")" && pwd)/$(basename "$c")"; break; }
done
[ -n "$EL" ] || { echo "!! 找不到 Electron 测试二进制（app-mac/tools/Electron.app）"; exit 9; }
[ -n "$WINPOS" ] || { echo "!! 找不到 winpos 窗口采样工具（evidence/round11-A/scenarios/bin/winpos）"; exit 9; }
APP="$T/testapp"
CFG="$T/cfg.json"
mkdir -p "$T" "$OUT"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "PASS  $*"; }
bad(){ FAIL=$((FAIL+1)); echo "FAIL  $*"; }
nowms(){ python3 -c 'import time;print(int(time.time()*1000))'; }
# 从 panel.log 找 pattern 首次出现行的日志时间戳（epoch ms）
ts_of(){ python3 - "$LOG" "$1" <<'PY'
import sys,re,datetime
log,pat=sys.argv[1],sys.argv[2]
try: lines=open(log,encoding='utf-8',errors='ignore').read().splitlines()
except Exception: lines=[]
for line in lines:
    if re.search(pat,line):
        m=re.match(r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+)Z',line)
        if m:
            dt=datetime.datetime.strptime(m.group(1),'%Y-%m-%dT%H:%M:%S.%f')
            print(int((dt-datetime.datetime(1970,1,1)).total_seconds()*1000)); sys.exit(0)
print("")
PY
}
has(){ grep -qE "$1" "$LOG" 2>/dev/null; }
cnt(){ local n; n=$(grep -cE "$1" "$LOG" 2>/dev/null || true); echo "${n:-0}"; }
wait_for(){ # <pattern-regex> <timeoutMs>
  local pat="$1" to="${2:-10000}" t0; t0=$(nowms)
  while :; do
    has "$pat" && return 0
    [ $(( $(nowms) - t0 )) -ge "$to" ] && return 1
    sleep 0.1
  done
}
win_visible(){ # <pid>
  local pid="$1" f="$T/win-check.jsonl"
  rm -f "$f"
  "$WINPOS" "$pid" 80 350 "$f" >/dev/null 2>&1
  grep -q '饭桶余额' "$f" 2>/dev/null
}
count_mode(){ # <模式> [起始行号] — 桩采样 trace 里的出现次数（证明确实喂到该模式）
  local mode="$1" from="${2:-0}"
  tail -n +$((from+1)) "$TRACE" 2>/dev/null | grep -c "^${mode} " || true
}
cleanup(){ stop_app; }
trap cleanup EXIT

# ---------------- 测试副本（仅跳过权限引导窗 2 行，与 app-mac/main.js 的差异写进 OUT）----------------
setup_testapp(){
  rm -rf "$APP"; mkdir -p "$APP"
  ( cd "$APP_SRC" && tar cf - --exclude=./build --exclude=./tools . ) | ( cd "$APP" && tar xf - )
  # 桩 petprobe（替代真实 native/petprobe，不动 Coopanion、不请求屏幕权限）
  cat > "$APP/native/petprobe" <<'STUB'
#!/bin/bash
# [r21 测试桩] 按控制文件内容输出 petprobe JSON 行：pet/pet_static=窗口存在；capture_err=SCK 失败但带 wid（窗口存在）；其他=no-pet-window
CTL="${PBP_TEST_PET_CONTROL:?}"
TRACE="${PBP_TEST_TRACE:-}"
while true; do
  MODE="$(cat "$CTL" 2>/dev/null || echo nopet)"
  [ -n "$TRACE" ] && printf '%s %s\n' "$MODE" "$(date +%H:%M:%S)" >> "$TRACE"
  case "$MODE" in
    pet)
      X=$((600 + RANDOM % 40))
      echo "{\"ok\":true,\"wid\":999001,\"winX\":$X,\"winY\":700,\"winW\":150,\"winH\":160,\"scale\":2,\"feetPt\":880,\"headPt\":740,\"centerPt\":$((X+75)),\"bodyCenterPt\":$((X+75)),\"charWpt\":86.5,\"charHpt\":140,\"captureMs\":5,\"scanMs\":2}"
      ;;
    pet_static)
      echo "{\"ok\":true,\"wid\":999001,\"winX\":620,\"winY\":700,\"winW\":150,\"winH\":160,\"scale\":2,\"feetPt\":880,\"headPt\":740,\"centerPt\":695,\"bodyCenterPt\":695,\"charWpt\":86.5,\"charHpt\":140,\"captureMs\":5,\"scanMs\":2}"
      ;;
    capture_err)
      echo "{\"ok\":false,\"reason\":\"capture-error: 桩：SCK 截图失败（窗口仍在，带 wid）\",\"wid\":999001,\"winX\":620,\"winY\":700,\"winW\":150,\"winH\":160,\"scale\":2,\"captureMs\":5}"
      ;;
    silent)
      : # 探针无输出（模拟 petprobe 挂了/没权限）→ 存在性信号未知，交给 5s 新鲜度兜底
      ;;
    *)
      echo '{"ok":false,"reason":"no-pet-window"}'
      ;;
  esac
  sleep 0.125
done
STUB
  chmod +x "$APP/native/petprobe"
  # 只改 2 行：① 启动时不弹权限引导窗；② 强制启动 petprobe（桩不需要系统屏幕录制权限）
  python3 - "$APP/main.js" <<'PY'
import sys, pathlib, re
p = pathlib.Path(sys.argv[1]); s = p.read_text(encoding='utf-8')
a = "    if (!checkScreenPermission()) {\n      showGuideWindow('no-screen-permission');"
b = "    if (false) { // [r21 测试副本] 跳过权限引导窗（桩 petprobe 不需要系统权限）\n      showGuideWindow('no-screen-permission');"
assert s.count(a) == 1, 'patch1 missing'
s = s.replace(a, b)
c = "  if (checkScreenPermission()) {\n    locator.start();"
d = "  if (true) { // [r21 测试副本] 桩 petprobe 无需系统权限\n    locator.start();"
assert s.count(c) == 1, 'patch2 missing'
s = s.replace(c, d)
# 测试副本再注入「只读可见性日志」：开发版 Electron 的隐藏窗口在 CGWindowList 里仍被列为 onscreen=true，
# 无法作为隐藏判据；这里在 hide/show 状态赋值后打一行 panelWin.isVisible()（只写日志、不改行为、由 PBP_TEST_VISLOG 开关）。
dbg_h = "if (process.env.PBP_TEST_VISLOG) logger.write('DEBUG visible-after-hide=' + panelWin.isVisible());\n"
dbg_s = "if (process.env.PBP_TEST_VISLOG) logger.write('DEBUG visible-after-show=' + panelWin.isVisible());\n"
s, n1 = re.subn(r'( *)noPetHidden = true;\n', lambda m: m.group(0) + m.group(1) + dbg_h, s)
s, n2 = re.subn(r'( *)panelShown = true;\n', lambda m: m.group(0) + m.group(1) + dbg_s, s)
assert n1 == 2, 'vislog-hide patch count=%d' % n1
assert n2 == 2, 'vislog-show patch count=%d' % n2
p.write_text(s, encoding='utf-8')
PY
  diff -u "$APP_SRC/main.js" "$APP/main.js" > "$OUT/testapp-only-diff.txt" 2>&1 || true
  # 测试配置（隔离目录 + 无网络 provider，避免碰真配置/主题接口）
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
start_app(){ # <tag>
  local tag="$1"
  LOG="$T/panel-$tag.log"; CTL="$T/pet-control-$tag"; TRACE="$T/trace-$tag.log"
  PANEL_DIR="$T/panelcfg-$tag"; UD="$T/ud-$tag"
  mkdir -p "$PANEL_DIR" "$UD"
  : > "$LOG"; : > "$TRACE"; echo pet > "$CTL"   # 各用例都从「桌宠窗口存在」起步（T6 再在宽限内切走）
  env -u ELECTRON_RUN_AS_NODE PBP_TEST_PET_CONTROL="$CTL" PBP_TEST_TRACE="$TRACE" PBP_TEST_VISLOG=1 \
    GLUTTONBALANCE_PANEL_DIR="$PANEL_DIR" GLUTTONBALANCE_PANEL_LOG="$LOG" \
    "$EL" "$APP" --user-data-dir="$UD" --config "$CFG" > "$OUT/stdout-$tag.log" 2>&1 &
  APP_PID=$!
  for _ in $(seq 1 150); do [ -s "$LOG" ] && break; sleep 0.1; done
}
settle_pet(){ local tag="$1"; echo pet > "$CTL"; sleep 1.2; }
# 等过「启动 10s 宽限」：宽限内桌宠短暂缺失不隐藏（T6 专门测），除 T1/T4/T6 外其余用例先等过去
wait_past_grace(){
  local t; t=$(ts_of 'Z start ')
  [ -z "$t" ] && t=$(nowms)
  local deadline=$(( t + 10600 ))
  while [ "$(nowms)" -lt "$deadline" ]; do sleep 0.2; done
}

echo "== 第 21 轮甲路 · 桌宠隐藏→饭桶立即隐藏 生命周期实测（隔离实例+桩 petprobe）$(date -Iseconds) =="
echo "测试副本=${APP}（与 app-mac/main.js 仅差 2 行：跳过权限引导窗/强制起桩，见 $OUT/testapp-only-diff.txt）"
setup_testapp
echo "Electron=$EL"
echo "winpos=$WINPOS"

# ---------------- T1：窗口消失 300ms 后恢复 → 不隐藏 ----------------
start_app t1
if wait_for 'panel shown' 15000; then ok "T1 前置：桌宠窗口存在 → 面板显示"; else bad "T1 前置：15s 内未显示面板"; fi
settle_pet t1
T1_BASE=$(wc -l < "$TRACE" | tr -d ' ')
echo nopet > "$CTL"; sleep 0.3; echo pet > "$CTL"
sleep 1.8
T1_MISS=$(count_mode nopet "$T1_BASE")
T1_HIDE=$(cnt 'panel hide')
[ "${T1_HIDE:-0}" = "0" ] && ok "T1：窗口消失 300ms 后恢复 → 0 条 panel hide（未隐藏；期间采到 ${T1_MISS} 帧 no-pet-window）" \
  || bad "T1：300ms 抖动被误隐藏（panel hide=${T1_HIDE}）"
[ "${T1_MISS:-0}" -ge 1 ] && ok "T1 有效性：抖动期间桩确实输出过 no-pet-window（${T1_MISS} 帧）" \
  || bad "T1 有效性：抖动期间没采到 no-pet-window（测试无效，需加大抖动窗口）"
win_visible "$APP_PID" && ok "T1：窗口仍可见（CGWindowList）" || bad "T1：窗口不可见（应保持可见）"
stop_app
cp "$LOG" "$OUT/T1-panel.log" 2>/dev/null || true

# ---------------- T2/T3：持续消失 → ≤1.2s 隐藏 → 回来 → 自动显示 ----------------
start_app t2
if wait_for 'panel shown' 15000; then ok "T2 前置：桌宠窗口存在 → 面板显示"; else bad "T2 前置：15s 内未显示面板"; fi
settle_pet t2
wait_past_grace
T2_T0=$(nowms); echo nopet > "$CTL"
if wait_for 'panel hide reason=pet-hidden' 5000; then
  T2_TS=$(ts_of 'panel hide reason=pet-hidden')
  T2_D=$(( T2_TS - T2_T0 ))
  if [ "$T2_D" -le 1200 ]; then ok "T2：窗口消失 → panel hide reason=pet-hidden 实测 ${T2_D}ms（≤1200ms，日志行：$(grep -m1 'panel hide reason=pet-hidden' "$LOG" | sed 's/^[^ ]* //')）"; else bad "T2：隐藏延迟 ${T2_D}ms > 1200ms"; fi
  T2_LINE=$(grep -m1 'panel hide reason=pet-hidden' "$LOG" | sed 's/^[^ ]* //')
  T2_MS=$(echo "$T2_LINE" | sed -n 's/.*missingMs=\([0-9]*\).*/\1/p')
  [ -n "$T2_MS" ] && [ "$T2_MS" -ge 600 ] && [ "$T2_MS" -le 1200 ] && ok "T2 内部计时：missingMs=${T2_MS}ms（阈值 600ms + 采样余量）" || bad "T2 内部计时异常：missingMs=${T2_MS:-空}"
else
  bad "T2：窗口消失 5s 内未出现 panel hide reason=pet-hidden"
fi
[ "$(cnt 'panel hide reason=no-pet')" = "0" ] && ok "T2：走的是窗口存在性快路径（0 条 5s 兜底 reason=no-pet）" || bad "T2：走了旧 5s 兜底路径"
sleep 0.5
has 'DEBUG visible-after-hide=false' && ok "T2：Electron 原生窗口已隐藏（panelWin.isVisible()=false，测试副本只读日志）" || bad "T2：隐藏后 isVisible 仍为 true"
if win_visible "$APP_PID"; then echo "   INFO T2：CGWindowList 采样仍列出该窗口（已知开发版 Electron 隐藏窗仍标 onscreen=true，不作判据；以 isVisible 为准）"; fi
# T3
T3_T0=$(nowms); echo pet > "$CTL"
if wait_for 'panel show reason=pet-detected' 5000; then
  T3_TS=$(ts_of 'panel show reason=pet-detected'); T3_D=$(( T3_TS - T3_T0 ))
  if [ "$T3_D" -le 1500 ]; then ok "T3：桌宠窗口回来 → panel show reason=pet-detected 实测 ${T3_D}ms（≤1500ms）"; else bad "T3：自动显示延迟 ${T3_D}ms > 1500ms"; fi
else
  bad "T3：窗口回来 5s 内未自动显示（缺 panel show reason=pet-detected）"
fi
sleep 0.5
has 'DEBUG visible-after-show=true' && ok "T3：Electron 原生窗口重新可见（panelWin.isVisible()=true）" || bad "T3：自动显示后 isVisible 仍为 false"
win_visible "$APP_PID" && ok "T3：CGWindowList 采样窗口在屏幕上" || bad "T3：CGWindowList 采样窗口不在屏幕上"
[ "$(cnt 'panel hide reason=pet-hidden')" = "1" ] && ok "T2/T3 附加：整周期只隐藏 1 次（无重复 hide 刷屏）" || bad "T2/T3 附加：pet-hidden 次数=$(cnt 'panel hide reason=pet-hidden')（期望 1）"
stop_app
cp "$LOG" "$OUT/T2-T3-panel.log" 2>/dev/null || true

# ---------------- T4：只发 capture-error（带 wid，窗口其实还在）→ 不隐藏（旧 5s 兜底也不能误判）----------------
start_app t4
if wait_for 'panel shown' 15000; then ok "T4 前置：桌宠窗口存在 → 面板显示"; else bad "T4 前置：15s 内未显示面板"; fi
settle_pet t4
T4_BASE=$(wc -l < "$TRACE" | tr -d ' ')
echo capture_err > "$CTL"
sleep 8
T4_HIDE=$(cnt 'panel hide')
T4_N=$(count_mode capture_err "$T4_BASE")
[ "${T4_HIDE:-0}" = "0" ] && ok "T4：capture-error（带 wid）持续 8s → 0 条 panel hide（SCK 失败不误判为桌宠消失；采到 ${T4_N} 帧 capture-error）" \
  || bad "T4：capture-error 期间被误隐藏（panel hide=${T4_HIDE}）"
[ "${T4_N:-0}" -ge 30 ] && ok "T4 有效性：8s 内确实持续输出 capture-error（${T4_N} 帧 ≥30）" || bad "T4 有效性：capture-error 帧数不足（${T4_N}）"
win_visible "$APP_PID" && ok "T4：窗口保持可见（CGWindowList）" || bad "T4：窗口不可见（应保持可见）"
stop_app
cp "$LOG" "$OUT/T4-panel.log" 2>/dev/null || true

# ---------------- T5：桌宠完全退出（no-pet-window 持续）→ 隐藏且保持隐藏 ----------------
start_app t5
if wait_for 'panel shown' 15000; then ok "T5 前置：桌宠窗口存在 → 面板显示"; else bad "T5 前置：15s 内未显示面板"; fi
settle_pet t5
wait_past_grace
echo nopet > "$CTL"
if wait_for 'panel hide reason=pet-hidden' 5000; then ok "T5：桌宠完全退出 → panel hide reason=pet-hidden"; else bad "T5：5s 内未隐藏"; fi
sleep 2.5
[ "$(cnt 'panel hide reason=pet-hidden')" = "1" ] && ok "T5：隐藏后保持隐藏、不重复 hide（count=1）" || bad "T5：hide 次数=$(cnt 'panel hide reason=pet-hidden')（期望 1）"
[ "$(cnt 'panel show reason=pet-detected')" = "0" ] && ok "T5：桌宠未回来 → 不会被误显示（0 条 pet-detected）" || bad "T5：桌宠不在时误显示"
T5_HIDE_LINE=$(grep -n 'DEBUG visible-after-hide=false' "$LOG" | tail -1 | cut -d: -f1)
T5_REVIVE=$(tail -n +$(( ${T5_HIDE_LINE:-0} + 1 )) "$LOG" | grep -c 'DEBUG visible-after-show=true' || true)
[ "${T5_REVIVE:-0}" = "0" ] && ok "T5：隐藏后 2.5s 内没有被任何逻辑误复活（isVisible 保持 false，0 条 visible-after-show=true）" || bad "T5：隐藏后被误复活（visible-after-show=true × ${T5_REVIVE}）"
if win_visible "$APP_PID"; then echo "   INFO T5：CGWindowList 采样仍列出该窗口（同上，开发版 Electron 隐藏窗仍标 onscreen=true，不作判据）"; fi
stop_app
cp "$LOG" "$OUT/T5-panel.log" 2>/dev/null || true

# ---------------- T6：启动宽限 —— 启动后 3s 隐藏桌宠 → 10s 宽限内不隐藏，过宽限才隐藏 ----------------
start_app t6
if wait_for 'panel shown' 15000; then ok "T6 前置：桌宠窗口存在 → 面板显示"; else bad "T6 前置：15s 内未显示面板"; fi
settle_pet t6
T6_T0=$(nowms); echo nopet > "$CTL"
sleep 3
T6_EARLY=$(cnt 'panel hide')
[ "${T6_EARLY:-0}" = "0" ] && ok "T6：启动宽限内（消失约 3s，仍在 10s 宽限内）未隐藏" || bad "T6：启动宽限内被隐藏（panel hide=${T6_EARLY}）"
if wait_for 'panel hide reason=pet-hidden' 9000; then
  T6_TS=$(ts_of 'panel hide reason=pet-hidden'); T6_D=$(( T6_TS - T6_T0 ))
  if [ "$T6_D" -ge 6000 ] && [ "$T6_D" -le 13000 ]; then ok "T6：宽限结束（启动约 10s）后才隐藏，实测消失后 ${T6_D}ms"; else bad "T6：隐藏时机异常（消失后 ${T6_D}ms，期望 6~13s）"; fi
else
  bad "T6：过启动宽限后仍未隐藏"
fi
stop_app
cp "$LOG" "$OUT/T6-panel.log" 2>/dev/null || true

# ---------------- 附加 T7：探针无输出（存在性信号未知，模拟 petprobe 挂了）→ 原 5s 兜底仍生效 ----------------
start_app t7
if wait_for 'panel shown' 15000; then ok "T7 前置：桌宠窗口存在 → 面板显示"; else bad "T7 前置：15s 内未显示面板"; fi
settle_pet t7
wait_past_grace
T7_T0=$(nowms); echo silent > "$CTL"
if wait_for 'panel hide reason=no-pet' 12000; then
  T7_TS=$(ts_of 'panel hide reason=no-pet'); T7_D=$(( T7_TS - T7_T0 ))
  if [ "$T7_D" -ge 4000 ] && [ "$T7_D" -le 8000 ]; then ok "T7（附加）：探针无输出 → 保留的 5s 新鲜度兜底生效（panel hide reason=no-pet，实测 ${T7_D}ms）"; else bad "T7（附加）：兜底时机异常（${T7_D}ms）"; fi
  [ "$(cnt 'panel hide reason=pet-hidden')" = "0" ] && ok "T7（附加）：信号未知时不会误走快路径（0 条 pet-hidden）" || bad "T7（附加）：信号未知却走了快路径"
else
  bad "T7（附加）：探针无输出 12s 内未走 5s 兜底隐藏"
fi
stop_app
cp "$LOG" "$OUT/T7-panel.log" 2>/dev/null || true

echo
echo "== 结果：PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -gt 0 ] && exit 1
exit 0
