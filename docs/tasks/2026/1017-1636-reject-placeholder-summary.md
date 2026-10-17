---
status: completed
pipeline_phase: null
plan: null
base_ref: null
perspectives: null
max_refine_rounds: 3
retries_remaining: 1
check_command: "npm run build && npm run check:strict && npm run test:run && for t in .github/scripts/*.test.sh; do bash \"$t\" || exit 1; done"
assignee: null
branch: task/1017-1636-reject-placeholder-summary
created_at: 2026-10-17T16:36:00Z
updated_at: 2026-10-17T17:02:31Z
---

# fix(release): treat a summary that keeps the placeholder text as unwritten

## Overview

`summary_is_unwritten` in `.github/scripts/release-summary.sh` decides
whether the release PR's summary has been written. It treats the summary
as unwritten while the sentinel comment `<!-- release-summary:todo -->`
is present or when nothing but HTML comments and whitespace remain. If
someone deletes only the sentinel and leaves the placeholder sentence
(`_Write the release summary here. ..._`, from `summary_placeholder`),
the check passes and the placeholder sentence becomes the body of the
GitHub Release.

Also treat a summary as unwritten when it still contains the first line
of the placeholder sentence. Derive that line from
`summary_placeholder` (or a shared definition both use) rather than
duplicating the text, so the two cannot drift.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `release-summary.test.sh` asserts that a summary which keeps the
      placeholder sentence but no sentinel is unwritten, and that
      `validate-release-summary.sh` rejects it.
- [x] `release-summary.test.sh` still asserts that a written summary is
      accepted, including one that mentions the words "release summary"
      in its own text.
