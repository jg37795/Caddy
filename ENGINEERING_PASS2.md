# Caddy engineering pass 2 — final report

## Scope

Reviewed AI_AUDIT.md, CLEANUP_REPORT.md and pass-1 commit 815b881 against code.
POST_ASTRA_AUDIT.md was not present in the checkout, remote main, Desktop or
Downloads; nothing was assumed from it. The static vanilla-JS PWA architecture
and all existing golf physics were retained. No runtime dependencies were
added; there is no server, auth, token, or runtime environment config — all
APIs are keyless and user data stays on-device. Handicap/net scoring is not a
current product feature (strokeIndex is course metadata only).

## Release

- v1.24.0 commits: `9dcfcc4` (main pass-2 work) and `975fa1c` (review follow-up).
- Both pushed to main; GitHub Pages builds succeeded and verified deployed
  files match the commits byte-for-byte.

## Major problems found and fixed (with root causes)

1. **Round/scoring integrity**
   - Nine-hole rounds could address hole 18 and Clear restored 18 rows —
     layout clamped to the chosen course everywhere; Clear reuses the
     session's scorecard shape; blank 18-row legacy cards normalize to the
     retained round layout at boot.
   - Partner sheet selection leaked into personal mini-sheet editing and
     copied partner/undefined scores into the user's card — partner writes are
     isolated; personal drafts reset on open; partner cells validated.
   - Malformed/null/invalid persisted rows crashed boot or miscounted stats —
     scorecards/rosters/rows normalize in place (positions never shift) and
     hydration runs before renderers.
   - History was aggregate-only with duplicate entries and lost course pars
     after the round ended — stable round IDs upsert; full scorecard, course,
     pars and holes-count are embedded; Stats reads embedded detail directly.
   - A failed history write still ended the round — failure keeps the round
     open with an honest notice; discard without GPS no longer dereferences
     null; tee changes refresh retained round metadata before summarizing.

2. **Course/green data & calculations**
   - Play → 3D Green crashed with `course is not defined` — course/hole/pin
     are carried on the resolved payload; regression covers the navigation.
   - Saved outlines keyed by 3-decimal coordinates + 100 m nearest lookup let
     adjacent greens share/overwrite records — identity is now the green's own
     polygon (precise coordinates + containment, 3 m noise cap), legacy data
     is migrated by stored coordinates; a relocated pin 133 m away never
     inherits the old locked ring (regression pinned).
   - Green briefs ignored `[lat,lng]` tuple rings, simulated outside the green,
     mixed surrounding terrain into mean slope, and reversed N/S fall/high
     bearings — ring shape normalized, masks applied, unusable data rejected
     instead of fabricating zero-break advice; bearings match the 3D tool.
   - Old/misconfigured/neighbor briefs supplied current-hole advice; one
     global in-flight job skipped other holes — owner/age/revision/stimp/ring/
     tee validation, per-green coalescing, restore invalidation; Prep honors
     the 3D tool's stimp setting.
   - Elevation sampling flipped latitude on north-up GeoTIFFs and request
     timeout/cancel ended at headers — north-correct sampling, timeout/cancel
     live through JSON/GeoTIFF body reads; satellite high-half tint now
     matches the physical bearing.
   - Live weather always returned HTTP 400 (unsupported `sunset` in current) —
     daily sunset in Unix time; fresh HTTP 200 verified live; elevation cache
     keys follow actual endpoint precision.

3. **Storage, backup, offline**
   - Backup omitted outlines/partners/tee memory/snapshots/settings; restore
     mixed unrelated rounds and quota failures claimed success; Bag's stale
     memory could undo a restore — allowlist extended, pre-validation,
     absent-key removal, rollback, rehydration event; corrupt prefs/snapshots
     recover safely; SW offline deep-links return the right document, HTTP
     failures fall back to the correct route/asset, and cache-write failures
     no longer discard good network responses.
   - Release identifiers aligned across About/HTML/SW with a production-shell
     guard (v1.24.0).

## Verification

- 38/38 suites (19 original + 19 new regression suites; each new suite was
  first shown failing against the buggy behavior). Syntax 54/54.
- 48/48 in-app physics/self-checks (geodesy, density, trajectory, wind signs,
  expected strokes, dispersion, tee-set, planner) unchanged and green.
- Real Edge (mobile viewport, `/Caddy/` scope): full 9-hole round (create →
  score/edit → reload → partner isolation → end/save → per-hole stats), full
  offline navigation (airplane-mode deep link + return), Play → 3D Green →
  back with live USGS. Zero console/page errors in each.
- Independent reviews of the state and green/network diffs each found one
  remaining issue; both were reproduced, fixed, and regression-tested
  (tee-change metadata refresh; outline identity at relocated pins).
- ESLint correctness scan (installed outside the project) reports only four
  pre-existing dead-code items (unreachable/constant conditions) — no new
  findings; no typecheck or bundler exists (zero-build static PWA).

## Remaining known issues (low-risk / by design)

- Four pre-existing dead-code lint findings; legacy snapshot-based dashboard
  history remains readable but less detailed than new entries.
- Old overwritten outline data can't be reconstructed; briefs now require
  recompute after upgrades (by design, to avoid stale wrong math).
- SW evidence combines a live offline Edge test with deterministic VM suites.

## Recommended manual tests (device)

1. iPhone homescreen: GPS accuracy/follow during a real hole, shot capture
   haptics (Taptic), screen wake during a pending shot.
2. Airplane-mode launch → all tabs → 3D Green deep link → back.
3. Round with tee switch mid-round → end/save → Stats hole detail.
4. Re-install/add-to-homescreen icon rendering (data-URI icon).

## Next-pass candidates

- WHS handicap/net scoring is a product decision plus real implementation —
  worth a dedicated pass if wanted.
- On-device field validation of the user's actual courses (green outlines,
  briefs) remains the highest-value quality check.
- Optional: extract GreenMapCore (greenmap-core.js) to slim the app shell.
