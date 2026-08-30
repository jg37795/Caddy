#!/bin/bash
# fire_audit3.sh — v3: correct resume syntax (hermes chat --resume SESSION).
cd "C:/Users/wendy/Desktop/Caddy/Caddy-main"
hermes chat --resume 20260830_083640_fbcb4f \
  -q "Proceed with the audit now. You have file tools — READ ONLY: do not edit any file. Read the repo files directly (greenmap.js, greenedit.js, greenlink.js, satview.js, caddy-elev.js, app.js, index.html, app.css, greenmap.html, greenmap.css, sw.js, range.js, bag.js, prep.js, tests/). Take your time, be thorough, then produce the report in EXACTLY the output contract from my first message (### Findings / ### Non-issues verified, nothing else)." > .gtds/grok_audit_report.md 2>&1
echo "AUDIT_DONE exit=$?" >> .gtds/grok_audit_report.md
