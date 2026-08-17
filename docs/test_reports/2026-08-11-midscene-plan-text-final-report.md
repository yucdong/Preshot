# Midscene Text Component UI Automation Final Report

**Date:** 2026-08-11
**Model:** `gpt-5.6-sol` (family `gpt-5`)
**Upstream proxy:** `http://localhost:4141/v1`
**Protocol bridge:** `http://127.0.0.1:4142/v1`
**Viewport:** 1440 × 900
**Final result:** 8 / 8 scenarios passed

## Report Entry

Final merged report:

`midscene_run/report/E2E-Preshot-Plan-Text-Final-2026-08-11T09-25-39-015Z.html`

This HTML includes screenshots, AI planning, targeting, actions, and verification traces for all 8 officially passing scenarios. The raw evidence is located at:

`test-results/midscene/`

Both directories are local test artifacts and are ignored by Git.

## Scenario Results

| Case | Scenario | Result | Passing run time |
|---|---|---:|---:|
| M01 | New project, insert text, edit/save, and cleanup | Passed | 2m 03s |
| M02 | Block types, font sizes, inline formatting, and alignment | Passed | 7m 40s |
| M03 | Theme colors, custom picker, RGB, and links | Passed | 11m 56s |
| M04 | Lists, nesting, quotes, and code blocks | Passed | 7m 59s |
| M05 | Recursive splits, independent editing, delete, and undo | Passed | 5m 59s |
| M06 | Reordering, resize, narrow toolbar, and close button | Passed | 9m 06s |
| M07 | Autosave, reload, undo, and redo | Passed | 7m 03s |
| M08 | PDF export, component deletion, and project cleanup | Passed | 5m 52s |

Passing scenarios took about 57m 38s in total. Each case created a unique `UIAUTO-*` project through the UI and removed it from Recent Projects at the end.

## Cleanup Audit

The official `result.json` files for M01–M08 all satisfy:

```json
{
  "cleanupUi": "passed",
  "cleanupError": null,
  "remainingKeys": []
}
```

No Midscene workspace, project, or plan storage keys were left behind. The failed diagnostic run used an isolated Chromium context, and the later official reruns also completed UI cleanup.

## Issues Found and Fixed

### P1 — Newly inserted components prevented project reopen after save and reload (high, fixed)

**Midscene discovery path:** M07 first created a new project, inserted text, applied formatting, and split it left/right; autosave succeeded. After reload, the app failed with:

```text
Stored plan component 0 has unsupported v10 fields
```

**Root cause:** `ProjectCanvasProvider` created new components with a runtime field `y: 0`; `addComponent()` preserved that field in persisted state through object spread. Strict schema-v10 reload only allows `id/name/type/x/width/height/contentScale/textRoot`, so it rejected `y`.

**Fix:**

- the UI no longer writes `y` when constructing new components;
- `addComponent()` now explicitly projects schema-v10 fields at the domain boundary to keep runtime/unknown fields out of persisted objects;
- added a regression covering “a component inserted with illegal runtime `y` is sanitized and can be strictly reloaded.”

**Validation:**

- related Vitest: 20 / 20 passed;
- M07 real UI save → reload → strict reload → undo/redo passed;
- full-repo Vitest 468 / 468 and Playwright 54 / 54 passed.

### P2 — Dependency test false-timed out at 15s during full-repo parallel transforms (medium, fixed)

`src/app/plan/planDependencies.test.ts` hit the 15-second threshold twice under full-suite transform load, but passed in about 4 seconds when isolated. The module graph became heavier after adding Midscene dependencies.

Fix: the heavy dependency-assembly tests in this file now use a uniform 30-second limit. Final result: the full repo passed 86 files / 468 tests.

## Diagnostic Clarification

### The color picker “not turning red” was not a product defect

The initial AI scenario required a click on the mathematical far-right edge of the color wheel to produce exact `255/0/0`. In reality, the visual click landed just inside the circular boundary and produced `255/15/15`, which is a reasonable near-pure red; the original expectation was too strict.

Corrected flow:

1. Visually click the color wheel and verify a near-pure red;
2. set RGB precisely to `255/0/0`;
3. click Apply;
4. record the actual DOM.

Deterministic evidence:

```json
{
  "computedColor": "rgb(255, 0, 0)",
  "editorHtml": "<p><span style=\"color: rgb(255, 0, 0);\">Color and Link Test</span></p>"
}
```

Therefore, the color wheel and color-application feature passed.

## Remaining Risks

### R1 — Intermittent connection failures to the upstream proxy

During long scenarios, this appeared multiple times:

```text
AI call failed (attempt 1/4), retrying... Error: Connection error.
```

After retries, all official scenarios passed, and the bridge and upstream health checks always returned healthy. The bridge now has 3 upstream fetch retries, and Midscene has 3 model retries configured.

Impact: test time increased noticeably, with the full official run taking about 58 minutes; it is not suitable to run on every PR.

Recommendation: run it locally on demand or nightly; later inspect the 4141 proxy logs and concurrency/connection reuse limits.

### R2 — Midscene Playwright network-idle warning

Every scenario showed a Midscene notice: Playwright lacks the expected post-action network-idle equivalent. The current prompt explicitly waits for save/export states, so this did not cause scenario failures.

### R3 — Existing non-blocking warnings

- ESLint: `ThemeProvider.tsx` Fast Refresh warning, 0 errors;
- Vite: main JS chunk about 2.4 MB, with a >500 kB warning.

## Final Regression Matrix

| Check | Result |
|---|---:|
| Midscene AI UI scenarios | 8 / 8 passed |
| Midscene UI cleanup | 8 / 8 passed, zero residue |
| Vitest | 86 files / 468 tests passed |
| Playwright | 54 / 54 passed |
| TypeScript | Passed |
| ESLint | 0 errors / 1 existing warning |
| Production build | Passed, with existing large-chunk warning |
