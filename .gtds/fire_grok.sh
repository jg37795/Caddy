#!/bin/bash
# fire_grok2.sh — v2: pass the prompt via file so quoting survives.
cd "C:/Users/wendy/Desktop/Caddy/Caddy-main"
hermes chat -m "x-ai/grok-4.6" --reasoning high -t none \
  -q "$(cat .gtds/grok_prompt_full.txt)" > .gtds/grok_response.txt 2>&1
echo "GROK_DONE exit=$?" >> .gtds/grok_response.txt
