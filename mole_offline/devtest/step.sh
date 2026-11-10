#!/bin/bash
# usage: step.sh DIR 'json actions'   -> waits until done, prints new console lines
D=$1; shift
n=$(wc -l < "$D/console.log" 2>/dev/null || echo 0)
rm -f "${D:?}/cmd.done"; echo "$1" > "$D/cmd.tmp" && mv "$D/cmd.tmp" "$D/cmd.json"
for i in $(seq 1 600); do [ -f "$D/cmd.done" ] && break; sleep 0.5; done
tail -n +$((n+1)) "$D/console.log" | grep -av "cmd 1610\|cmd 1030\|cmd 1009\|cmd 1313\|cmd 1306\|1065\|Map_\|PreLoader" | cut -c1-220 | tail -${TAIL:-25}
