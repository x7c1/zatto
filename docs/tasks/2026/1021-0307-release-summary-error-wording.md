---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: [completeness, clarity, user-experience]
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done"
assignee: null
branch: task/1021-0307-release-summary-error-wording
created_at: 2026-10-20T18:07:20Z
updated_at: 2026-10-20T18:14:43Z
---

# fix(release): say how to fix an unwritten release summary, placeholder text included

## Overview

The release PR's summary check rejects a summary that is still unwritten:
either the sentinel comment is still there, or the sentinel was deleted
but the placeholder text was left as it is. The error message, printed
both by `.github/scripts/validate-release-summary.sh` and by the
"Resolve release summary" step of `.github/workflows/release.yml`, only
tells the author to write a summary above the marker and delete the
sentinel. An author who deleted the sentinel and kept the placeholder
reads that and cannot tell what is still wrong.

Reword both messages so they name what to do in either case: replace the
placeholder text with the real summary, and delete the sentinel comment.
Keep the two messages consistent with each other and with
`docs/guides/release.md`; if the guide describes the error or the
placeholder, keep it in step. Use the placeholder's actual wording or a
helper from `.github/scripts/release-summary.sh` rather than paraphrasing
it, if that reads better.

Only the wording changes. What counts as unwritten stays as it is.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] The `::error::` message of `validate-release-summary.sh` for an
      unwritten summary tells the author to replace the placeholder text and
      delete the sentinel comment, and a test in
      `.github/scripts/*.test.sh` asserts that wording for a body whose
      sentinel was deleted but whose placeholder was kept.
- [x] The corresponding `::error::` line in `.github/workflows/release.yml`
      gives the same instruction.
