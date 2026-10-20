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
branch: task/1021-0412-summary-placeholder-wording
created_at: 2026-10-20T19:12:48Z
updated_at: 2026-10-20T19:18:36Z
---

# fix(release): make the summary placeholder say to replace it, not only to delete the sentinel

## Overview

A freshly generated release PR body starts its summary with a sentinel
comment and a two-line placeholder (`summary_placeholder()` in
`.github/scripts/release-summary.sh`). The placeholder's second line,
"Delete the marker comment above once written.", tells the author only to
delete the sentinel. That invites the very mistake the summary check
rejects: deleting the sentinel and leaving the placeholder in place. It
also calls the sentinel "the marker comment", while
`docs/guides/release.md` uses "marker" for `<!-- changelog:auto -->`.

Reword the placeholder's second line so it says to replace these lines
with the summary and delete the `<!-- release-summary:todo -->` comment
above them, naming the comment as the guide does. Keep the first line,
`summary_placeholder_line()`, exactly as it is: `summary_is_unwritten`
recognises an unwritten summary by that line, so release PR bodies
generated before this change, which still carry the old second line, keep
being rejected until a summary is written. Update the placeholder shown in
`docs/guides/release.md` to match, and any test fixture that spells the
old second line, while keeping one test that a body with the old second
line is still treated as unwritten.

## Acceptance criteria

### Automated (pipeline-verified)

- [x] `summary_placeholder()` no longer contains "Delete the marker comment
      above once written." and its second line tells the author to replace
      the placeholder and delete the `<!-- release-summary:todo -->`
      comment; a test in `.github/scripts/release-summary.test.sh` asserts
      it.
- [x] A test shows that a summary region holding the old placeholder (old
      second line) is still unwritten.
- [x] The placeholder in `docs/guides/release.md` matches
      `summary_placeholder()`.
