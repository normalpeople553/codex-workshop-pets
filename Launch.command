#!/bin/bash
set -eu

root="$(cd "$(dirname "$0")" && pwd)"
app="/Applications/ChatGPT.app"
profile="$HOME/Library/Application Support/Codex"
sessions="${CODEX_HOME:-$HOME/.codex}/sessions"
label="local.codex-workshop-pets.bridge"
log_dir="$HOME/Library/Logs/Codex Workshop Pets"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

stop_bridge() {
  if ! /bin/launchctl list "$label" >/dev/null 2>&1; then
    return 0
  fi
  /bin/launchctl remove "$label"
  for attempt in {1..50}; do
    if ! /bin/launchctl list "$label" >/dev/null 2>&1; then
      return 0
    fi
    sleep .1
  done
  printf '%s\n' '宠物桥接还在退出，请稍后重试。' >&2
  return 1
}

if [ "${1:-}" = "--stop" ]; then
  stop_bridge
  printf '%s\n' '宠物桥接已停止。'
  exit 0
fi

if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)'; then
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

debugger_ready() {
  local port
  [ -r "$profile/DevToolsActivePort" ] || return 1
  read -r port < "$profile/DevToolsActivePort" || return 1
  [[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$port" -le 65535 ] || return 1
  /usr/bin/curl -fs --max-time 2 "http://127.0.0.1:$port/json/version" >/dev/null
}

if ! debugger_ready; then
  if chatgpt_running; then
    printf '%s\n' '请切回 ChatGPT，按 ⌘Q 完整退出。启动器会自动重新打开它。' \
      '按 Ctrl+C 可取消等待。'
    while chatgpt_running; do
      sleep 1
    done
  fi
  /usr/bin/open -a "$app" --args "--user-data-dir=$profile" \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port=0
fi

if /bin/launchctl list | /usr/bin/awk -v label="$label" \
  '$3 == label && $1 ~ /^[0-9]+$/ { running=1 } END { exit !running }'; then
  printf '%s\n' '宠物桥接已经在后台运行。'
  exit 0
fi
stop_bridge
mkdir -p "$log_dir"
/bin/launchctl submit -l "$label" -o "$log_dir/bridge.log" -e "$log_dir/bridge.log" -- \
  "$(command -v node)" "$root/src/bridge.mjs" "$profile" "$sessions"
printf '%s\n' '宠物桥接已在后台启动。打开 Codex 聊天即可看到宠物。'
