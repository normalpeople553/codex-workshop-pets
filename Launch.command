#!/bin/bash
set -eu

root="$(cd "$(dirname "$0")" && pwd)"
app="/Applications/ChatGPT.app"
profile="$HOME/Library/Application Support/Codex"
sessions="${CODEX_HOME:-$HOME/.codex}/sessions"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22)'; then
  printf '%s\n' '需要 Node.js 22 或以上版本。'
  exit 1
fi
if [ ! -x "$app/Contents/MacOS/ChatGPT" ] || [ ! -d "$sessions" ]; then
  printf '%s\n' '请将 ChatGPT.app 安装到「应用程序」，并先打开 Codex 创建一条本地聊天。'
  exit 1
fi

chatgpt_running() {
  ps -axo comm= | /usr/bin/grep -Fxq "$app/Contents/MacOS/ChatGPT"
}

if chatgpt_running; then
  printf '%s\n' '请切回 ChatGPT，按 ⌘Q 完整退出。启动器会自动重新打开它。' \
    '按 Ctrl+C 可取消等待。'
  while chatgpt_running; do
    sleep 1
  done
fi

/usr/bin/open -a "$app" --args "--user-data-dir=$profile" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=0
printf '%s\n' '打开 Codex 聊天即可看到宠物。请保留这个终端窗口。'
exec node "$root/src/bridge.mjs" "$profile" "$sessions"
