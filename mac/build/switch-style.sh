#!/usr/bin/env bash
# 饭桶余额 · 一键切换显示方式（第 27 轮）
#   用法：./switch-style.sh            看当前是哪种
#         ./switch-style.sh ricebowl   吃饭碗（默认）
#         ./switch-style.sh minicard   macOS 小卡片
set -euo pipefail
CFG="$HOME/.dsh/glutton-balance/config.json"

if [ ! -f "$CFG" ]; then echo "找不到配置：$CFG" >&2; exit 1; fi

cur="$(node -e 'try{const c=require(process.argv[1]);process.stdout.write((c.display&&c.display.style)||"ricebowl")}catch(e){process.stdout.write("ricebowl")}' "$CFG")"

if [ $# -eq 0 ]; then
  case "$cur" in
    minicard) echo "当前：小卡片（minicard）  → 切换用：./switch-style.sh ricebowl";;
    *)        echo "当前：饭碗（ricebowl）   → 切换用：./switch-style.sh minicard";;
  esac
  exit 0
fi

want="$1"
case "$want" in
  ricebowl|minicard) ;;
  *) echo "只支持 ricebowl 或 minicard，收到：${want}" >&2; exit 2;;
esac

if [ "$cur" = "$want" ]; then echo "已经是 ${want}，不用切"; exit 0; fi

cp "$CFG" "$CFG.bak-before-style-$(date +%Y%m%d-%H%M%S)"
node -e '
const fs=require("fs"), p=process.argv[1], want=process.argv[2];
const c=JSON.parse(fs.readFileSync(p,"utf8"));
c.display=c.display||{}; c.display.style=want;
fs.writeFileSync(p, JSON.stringify(c,null,2));
' "$CFG" "$want"

echo "已切到：${want}（备份已存 config.json.bak-before-style-*）"

# 面板会热载配置；等它自己刷新，不行再重启
for i in $(seq 1 12); do
  sleep 0.5
  if grep -q "style=$want" "$HOME/.dsh/glutton-balance/panel.log" 2>/dev/null; then break; fi
done

# 靠 launchd 重启（面板自身有单实例锁，重启是安全的）
launchctl kickstart -k "gui/$(id -u)/com.gluttonbalance.panel" >/dev/null 2>&1 || true
sleep 2
if pgrep -f "饭桶余额.app/Contents/MacOS/Electron" >/dev/null; then
  echo "✅ 面板已刷新，当前：${want}"
else
  echo "⚠️ 面板没起来，回滚：cp $CFG.bak-before-style-* $CFG" >&2; exit 1
fi
