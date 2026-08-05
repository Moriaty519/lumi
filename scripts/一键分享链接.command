#!/bin/bash
# Lumi 关系大法官 · 一键生成可分享链接
# 可由桌面 App 静默调用（不弹出终端）

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

set -euo pipefail

PROJECT="/Users/work/Desktop/lumi/7.27测试/lumi-judge"
CPOLAR="/Applications/cpolar"
DEV_LOG="/tmp/lumi-share-dev.log"
CPOLAR_LOG="/tmp/lumi-share-cpolar.log"
PID_DIR="/tmp/lumi-share"
URL_FILE="$PID_DIR/url.txt"

mkdir -p "$PID_DIR"

notify() {
  osascript -e "display notification \"$2\" with title \"$1\"" 2>/dev/null || true
}

die() {
  osascript -e "display dialog \"$1\" with title \"分享失败\" buttons {\"好的\"} default button 1" 2>/dev/null || echo "$1"
  exit 1
}

# 切换到项目目录
cd "$PROJECT" || die "找不到项目文件夹，请确认路径：\\n$PROJECT"

# 检查 cpolar
if [[ ! -x "$CPOLAR" ]]; then
  die "找不到 cpolar。\\n请确认已安装：/Applications/cpolar"
fi

notify "Lumi 分享" "正在准备，请稍候…"

# —— 1. 启动开发服务（若 5173 还没起来）——
need_dev=1
if curl -s -o /dev/null --connect-timeout 2 "http://127.0.0.1:5173/" 2>/dev/null; then
  need_dev=0
fi

if [[ "$need_dev" -eq 1 ]]; then
  # 停掉旧的同名后台（避免重复）
  if [[ -f "$PID_DIR/dev.pid" ]]; then
    old=$(cat "$PID_DIR/dev.pid" 2>/dev/null || true)
    if [[ -n "${old:-}" ]] && kill -0 "$old" 2>/dev/null; then
      kill "$old" 2>/dev/null || true
      sleep 1
    fi
  fi
  nohup npm run dev >"$DEV_LOG" 2>&1 &
  echo $! >"$PID_DIR/dev.pid"
  # 等待前端就绪（最多约 90 秒）
  ready=0
  for _ in $(seq 1 90); do
    if curl -s -o /dev/null --connect-timeout 1 "http://127.0.0.1:5173/" 2>/dev/null; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ "$ready" -ne 1 ]]; then
    die "项目启动超时。\\n请打开终端手动执行 npm run dev 看报错。\\n日志：$DEV_LOG"
  fi
fi

# —— 2. 启动 / 重启 cpolar ——
# 先停掉旧隧道
if [[ -f "$PID_DIR/cpolar.pid" ]]; then
  oldc=$(cat "$PID_DIR/cpolar.pid" 2>/dev/null || true)
  if [[ -n "${oldc:-}" ]] && kill -0 "$oldc" 2>/dev/null; then
    kill "$oldc" 2>/dev/null || true
    sleep 1
  fi
fi
# 再扫一遍残留 cpolar http 5173
pkill -f "$CPOLAR http 5173" 2>/dev/null || true
sleep 1

: >"$CPOLAR_LOG"
nohup "$CPOLAR" http 5173 -log="$CPOLAR_LOG" -log-level=INFO >"$CPOLAR_LOG.stdout" 2>&1 &
echo $! >"$PID_DIR/cpolar.pid"

# —— 3. 从日志里抓取 https 链接 ——
URL=""
for _ in $(seq 1 45); do
  # 常见域名：cpolar.cn / cpolar.top / cpolar.io
  URL=$(
    {
      cat "$CPOLAR_LOG" 2>/dev/null
      cat "$CPOLAR_LOG.stdout" 2>/dev/null
    } | grep -oE 'https://[a-zA-Z0-9._-]+\.(cpolar\.(cn|top|io)|cpolar\.com)[^[:space:]\"'\'']*' \
      | head -1 || true
  )
  if [[ -n "$URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$URL" ]]; then
  die "没能拿到分享链接。\\n可能原因：\\n1) 网络不通\\n2) cpolar 未登录/套餐限制\\n请查看日志：\\n$CPOLAR_LOG"
fi

echo "$URL" >"$URL_FILE"
# 复制到剪贴板
printf '%s' "$URL" | pbcopy

notify "Lumi 分享" "链接已复制到剪贴板"

# —— 4. 弹窗：显示链接，可再复制 / 停止 ——
CHOICE=$(osascript <<EOF
set theURL to "$URL"
set the clipboard to theURL
set dlg to display dialog "别人能打开的链接（已自动复制到剪贴板）：

" & theURL & "

发给对方即可。
注意：分享期间请不要关机，也不要点「停止分享」。

点「再复制一次」可再次复制；
点「停止分享」会关掉外网入口。" buttons {"停止分享", "再复制一次", "完成"} default button "完成" with title "Lumi · 一键分享"
return button returned of dlg
EOF
)

case "$CHOICE" in
  "再复制一次")
    printf '%s' "$URL" | pbcopy
    osascript -e "display dialog \"已再次复制：\n\n$URL\" buttons {\"好的\"} default button 1 with title \"Lumi · 一键分享\"" >/dev/null
    ;;
  "停止分享")
    # 调用停止脚本逻辑
    if [[ -f "$PID_DIR/cpolar.pid" ]]; then
      kill "$(cat "$PID_DIR/cpolar.pid")" 2>/dev/null || true
    fi
    pkill -f "$CPOLAR http 5173" 2>/dev/null || true
    rm -f "$PID_DIR/cpolar.pid" "$URL_FILE"
    osascript -e 'display dialog "已停止外网分享。\n（本机项目如需继续调试可保持运行）" buttons {"好的"} default button 1 with title "Lumi · 一键分享"' >/dev/null
    ;;
  *)
    # 完成：保持分享运行
    ;;
esac

exit 0
