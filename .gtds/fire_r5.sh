#!/bin/bash
# fire_r5.sh — Grok R5: prep tab restructure + green-aware advice.
# Read-only audit done in R4 taught us: give it the repo + a runnable
# checker + permission to edit ONLY the five files in scope.
cd "C:/Users/wendy/Desktop/Caddy/Caddy-main"
BRIEF=$(cat .gtds/GROK_R5_BRIEF.md)
hermes chat -m "x-ai/grok-4.6" --reasoning high \
  -q "$BRIEF

You may EDIT these files only: prep.js, prep.css, index.html (prep
section markup), app.js (Block 18 bridge addition only), greenmap.js
(brief persistence only). Everything else read-only. node is available
for --check and the test files. When done: run node --check on each
touched file, run node tests/greenmap_boot_smoke.js (must print
BOOT+FLOW SMOKE PASSED), run node tests/greenmap_smoke.js (must show
exactly its 2 documented failures), then print a per-file summary of
your changes." > .gtds/grok_r5_response.txt 2>&1
echo "R5_DONE exit=$?" >> .gtds/grok_r5_response.txt
