# Agent MVP deterministic eval report

- Date: 2026-08-22
- Status: final current-worktree validation
- Mode: offline fixtures only; no live model, proxy, network, or user data
- Result: 54/54 checks passed
- Normalized events: 18/18
- Typed errors: 24/24
- Capability states: 6
- Adversarial proposal cases: 8
- Proposal golden: 8 allowed text block types plus nesting
- Attachment lifecycle cases: 5
- Full Vitest: 159 files / 1,069 tests
- Full Rust: 144 passed / 2 explicitly ignored live-proxy probes
- Playwright: 29 main / 14 focused BlockNote / 3 isolated capture
- Production x64 artifacts: 135,394,816-byte EXE / 122,089,472-byte MSI;
  both unsigned and non-publishable

| Area | Checks | Result |
| --- | ---: | --- |
| runtime fixtures | 3 | Pass |
| typed errors | 24 | Pass |
| provider capabilities | 6 | Pass |
| adversarial proposals | 8 | Pass |
| proposal golden | 1 | Pass |
| proposal lifecycle | 4 | Pass |
| attachment lifecycle | 5 | Pass |
| security boundary | 2 | Pass |
| privacy | 1 | Pass |

The runner proves that proposal construction/projection cannot mutate the
source plan, adversarial path/network/shell/media/schema fields are rejected,
stale revisions and hash conflicts fail closed, and mutation begins only at
the explicit Apply boundary. Static native contracts additionally verify
Empty mode, the four-tool allowlist, absence of renderer model-network access,
and metadata-only lifecycle logging.
