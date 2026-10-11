#!/bin/sh
cd /workspace
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
nohup npm run dev > /tmp/klyvona-dev.log 2>&1 &
exit 0
