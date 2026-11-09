#!/bin/bash
# usage: run_flow.sh actions.json extra_wait_secs out.png  -> filtered log on stdout
D=$(cd "$(dirname "$0")"/.. && pwd)
cd "$D/devtest"
NODE_PATH=$(npm root -g) timeout ${RUN_TIMEOUT:-1500} node run_browser.js "http://127.0.0.1:${PORT:-8090}/index.html?trace=1&r=${RENDERER:-wgpu-webgl}&q=${QUALITY:-low}" "$2" "$3" "$1" 2>&1 | stdbuf -oL cat \
 | grep -a --line-buffered -E "\[runner\]|\[mole\]|pageerror|log_adapter|ERROR|panic" | sed -u 's/.*log_adapter.rs:18%c//; s/ color: whitesmoke.*//; s/%cERROR%c//; s/ color: red;.*//' \
 | grep -a --line-buffered -vE "onLoaded1|loadCompleteHandler|^ onLoaded |已加载|XML导入成功|\[SEND\]|\[RECV"
