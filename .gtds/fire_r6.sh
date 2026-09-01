#!/bin/bash
# fire_r6.sh — Grok R6 one-shot: hole-view defect round.
# Fixed: hermes chat has no --append-system-prompt; use --query-file.
cd "C:/Users/wendy/Desktop/Caddy/Caddy-main"
hermes chat \
  -m x-ai/grok-4.6 \
  --reasoning high \
  -t none \
  --query-file .gtds/r6_query.txt \
  > .gtds/r6_stdout.txt 2>&1
