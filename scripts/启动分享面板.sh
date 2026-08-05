#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
export TK_SILENCE_DEPRECATION=1
pkill -f "scripts/share_gui.py" 2>/dev/null || true
sleep 0.25
exec /usr/bin/python3 "/Users/work/Desktop/lumi/7.27测试/lumi-judge/scripts/share_gui.py"
