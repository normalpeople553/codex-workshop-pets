#!/bin/bash
set -eu

root="$(cd "$(dirname "$0")" && pwd)"
app="/Applications/ChatGPT.app"
profile="$HOME/Library/Application Support/Codex"
sessions="${CODEX_HOME:-$HOME/.codex}/sessions"
label="local.codex-workshop-pets.bridge"
login_label="local.codex-workshop-pets.login"
login_plist="$HOME/Library/LaunchAgents/$login_label.plist"
login_runtime="$HOME/Library/Application Support/Codex Workshop Pets"
log_dir="$HOME/Library/Logs/Codex Workshop Pets"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
mode="${1:-}"

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

if [ "$mode" = "--stop" ]; then
  stop_bridge
  printf '%s\n' '宠物桥接已停止。'
  exit 0
fi

if [ "$mode" = "--disable-login" ]; then
  login_job="gui/$(/usr/bin/id -u)/$login_label"
  if /bin/launchctl print "$login_job" >/dev/null 2>&1; then
    /bin/launchctl bootout "$login_job"
  fi
  /bin/rm -f "$login_plist"
  printf '%s\n' '已关闭登录自启。'
  exit 0
fi

node_bin="$(command -v node || true)"
if [ "$mode" = "--at-login" ]; then
  node_bin="$2"
  sessions="$3"
fi
if [ ! -x "$node_bin" ] || ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)'; then
  printf '%s\n' '需要 Node.js 22 或以上版本。'
  exit 1
fi
if [ ! -x "$app/Contents/MacOS/ChatGPT" ] || [ ! -d "$sessions" ]; then
  printf '%s\n' '请将 ChatGPT.app 安装到「应用程序」，并先打开 Codex 创建一条本地聊天。'
  exit 1
fi

if [ "$mode" = "--enable-login" ]; then
  mkdir -p "$login_runtime" "$log_dir" "$(dirname "$login_plist")"
  # Run from Application Support so login does not depend on access to Documents.
  if [ "$root" != "$login_runtime" ]; then
    /bin/cp -R "$root/Launch.command" "$root/src" "$root/art" "$login_runtime/"
  fi
  plist_tmp="$(/usr/bin/mktemp "${login_plist}.XXXXXX")"
  trap '/bin/rm -f "$plist_tmp"' EXIT
  /usr/bin/plutil -create xml1 "$plist_tmp"
  /usr/bin/plutil -insert Label -string "$login_label" "$plist_tmp"
  /usr/bin/plutil -insert ProgramArguments -array "$plist_tmp"
  /usr/bin/plutil -insert ProgramArguments.0 -string /bin/bash "$plist_tmp"
  /usr/bin/plutil -insert ProgramArguments.1 -string "$login_runtime/Launch.command" "$plist_tmp"
  /usr/bin/plutil -insert ProgramArguments.2 -string --at-login "$plist_tmp"
  /usr/bin/plutil -insert ProgramArguments.3 -string "$node_bin" "$plist_tmp"
  /usr/bin/plutil -insert ProgramArguments.4 -string "$sessions" "$plist_tmp"
  /usr/bin/plutil -insert RunAtLoad -bool YES "$plist_tmp"
  /usr/bin/plutil -insert StandardOutPath -string "$log_dir/login.log" "$plist_tmp"
  /usr/bin/plutil -insert StandardErrorPath -string "$log_dir/login.log" "$plist_tmp"
  /usr/bin/plutil -lint "$plist_tmp" >/dev/null
  /bin/mv -f "$plist_tmp" "$login_plist"
  printf '%s\n' '已开启登录自启。下次登录 Mac 时生效。'
  exit 0
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

open_chatgpt() {
  /usr/bin/open -a "$app" --args "--user-data-dir=$profile" \
    --remote-debugging-address=127.0.0.1 --remote-debugging-port=0
}

wait_for_debugger() {
  for attempt in {1..15}; do
    if debugger_ready; then
      return 0
    fi
    sleep 1
  done
  return 1
}

recover_restored_window() {
  /usr/bin/osascript >/dev/null <<'APPLESCRIPT' || return 1
set choice to display dialog "ChatGPT 已经打开。若要恢复输入框上的宠物，请点「继续」，再切回 ChatGPT 按 ⌘Q。宠物启动器会重新打开 ChatGPT。" with title "Codex Workshop Pets" buttons {"稍后", "继续"} default button "继续" cancel button "稍后" giving up after 90
if gave up of choice then error number -128
APPLESCRIPT
  for attempt in {1..120}; do
    if debugger_ready || ! chatgpt_running; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! debugger_ready; then
  if [ "$mode" = "--at-login" ]; then
    if ! chatgpt_running; then
      open_chatgpt
      wait_for_debugger || true
    fi
    # Window restoration can win the race even if ChatGPT was closed above.
    if ! debugger_ready && chatgpt_running; then
      recover_restored_window || exit 0
    fi
  elif chatgpt_running; then
    printf '%s\n' '请切回 ChatGPT，按 ⌘Q 完整退出。启动器会自动重新打开它。' \
      '按 Ctrl+C 可取消等待。'
    while chatgpt_running && ! debugger_ready; do
      sleep 1
    done
  fi
  if ! debugger_ready; then
    open_chatgpt
  fi
  if [ "$mode" = "--at-login" ] && ! wait_for_debugger; then
    printf '%s\n' '无法连接 ChatGPT，请手动运行 Launch.command 重试。' >&2
    exit 1
  fi
fi

if /bin/launchctl list | /usr/bin/awk -v label="$label" \
  '$3 == label && $1 ~ /^[0-9]+$/ { running=1 } END { exit !running }'; then
  printf '%s\n' '宠物桥接已经在后台运行。'
  exit 0
fi
stop_bridge
mkdir -p "$log_dir"
/bin/launchctl submit -l "$label" -o "$log_dir/bridge.log" -e "$log_dir/bridge.log" -- \
  "$node_bin" "$root/src/bridge.mjs" "$profile" "$sessions"
printf '%s\n' '宠物桥接已在后台启动。打开 Codex 聊天即可看到宠物。'
