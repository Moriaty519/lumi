#!/bin/bash
# 停止 Lumi 外网分享（可由桌面 App 静默调用，不弹出终端）

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

CPOLAR="/Applications/cpolar"
PID_DIR="/tmp/lumi-share"

CHOICE=$(osascript <<'EOF'
set dlg to display dialog "要停止什么？

• 只停止分享：关掉外网链接，本机网站还可本地打开
• 全部停止：分享 + 本机项目都关掉" buttons {"取消", "全部停止", "只停止分享"} default button "只停止分享" with title "Lumi · 停止分享"
return button returned of dlg
EOF
)

case "$CHOICE" in
  "取消")
    exit 0
    ;;
  "只停止分享"|"全部停止")
    if [[ -f "$PID_DIR/cpolar.pid" ]]; then
      kill "$(cat "$PID_DIR/cpolar.pid")" 2>/dev/null || true
    fi
    pkill -f "$CPOLAR http 5173" 2>/dev/null || true
    rm -f "$PID_DIR/cpolar.pid" "$PID_DIR/url.txt"

    if [[ "$CHOICE" == "全部停止" ]]; then
      if [[ -f "$PID_DIR/dev.pid" ]]; then
        # npm run dev 是父进程，尽量杀掉进程树
        root=$(cat "$PID_DIR/dev.pid" 2>/dev/null || true)
        if [[ -n "${root:-}" ]]; then
          pkill -P "$root" 2>/dev/null || true
          kill "$root" 2>/dev/null || true
        fi
      fi
      # 兜底：占用 5173 / 3001 的常见进程
      for port in 5173 3001; do
        pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
        if [[ -n "${pids:-}" ]]; then
          kill $pids 2>/dev/null || true
        fi
      done
      rm -f "$PID_DIR/dev.pid"
    fi

    osascript -e "display dialog \"已执行：$CHOICE\" buttons {\"好的\"} default button 1 with title \"Lumi · 停止分享\"" >/dev/null
    ;;
esac

exit 0
