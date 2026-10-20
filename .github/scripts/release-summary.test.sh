#!/usr/bin/env bash
set -uo pipefail

# Unit tests for release-summary.sh.
#
# Usage:
#   bash release-summary.test.sh
#
# The marker is spelled out literally here on purpose: asserting the split
# against a hardcoded string is what makes this an independent check rather
# than a tautology over changelog_marker's own output.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-summary.sh
source "${SCRIPT_DIR}/release-summary.sh"

MARKER='<!-- changelog:auto -->'
SENTINEL='<!-- release-summary:todo -->'

failures=0

pass() {
    printf 'ok   - %s\n' "$1"
}

fail() {
    printf 'FAIL - %s\n' "$1"
    printf '%s\n' "$2"
    failures=$((failures + 1))
}

assert_eq() {
    local name="$1" expected="$2" actual="$3"
    if [ "$expected" = "$actual" ]; then
        pass "$name"
    else
        fail "$name" "  expected: $(printf '%q' "$expected")
  actual:   $(printf '%q' "$actual")"
    fi
}

assert_not_contains() {
    local name="$1" haystack="$2" needle="$3"
    if [[ "$haystack" != *"$needle"* ]]; then
        pass "$name"
    else
        fail "$name" "  unexpectedly found $(printf '%q' "$needle") in $(printf '%q' "$haystack")"
    fi
}

assert_contains() {
    local name="$1" haystack="$2" needle="$3"
    if [[ "$haystack" == *"$needle"* ]]; then
        pass "$name"
    else
        fail "$name" "  did not find $(printf '%q' "$needle") in $(printf '%q' "$haystack")"
    fi
}

assert_unwritten() {
    local name="$1" summary="$2"
    if summary_is_unwritten "$summary"; then
        pass "$name"
    else
        fail "$name" "  expected unwritten, got written: $(printf '%q' "$summary")"
    fi
}

assert_written() {
    local name="$1" summary="$2"
    if summary_is_unwritten "$summary"; then
        fail "$name" "  expected written, got unwritten: $(printf '%q' "$summary")"
    else
        pass "$name"
    fi
}

# changelog_marker is the one definition every other caller uses.
assert_eq "changelog_marker echoes the marker" "$MARKER" "$(changelog_marker)"

# --- summary_region ---------------------------------------------------------

body_with_marker=$(printf '%s\n' \
    '## Summary' \
    '' \
    'The strip follows the cursor.' \
    '' \
    "$MARKER" \
    '' \
    '## Features' \
    '' \
    '- feat: show the thumbnail strip')

region=$(summary_region "$body_with_marker")

assert_eq "summary_region returns the human region" \
    '## Summary

The strip follows the cursor.' \
    "$region"
assert_not_contains "summary_region drops the marker line" "$region" "$MARKER"
assert_not_contains "summary_region drops the changelog below" "$region" '## Features'

# Command substitution eats trailing newlines, so compare with a trailing
# sentinel character on both sides to see the blank lines that separated the
# summary from the marker.
region_raw="$(summary_region "$body_with_marker"; printf 'X')"
expected_raw="$(printf '%s\n' \
    '## Summary' \
    '' \
    'The strip follows the cursor.'; printf 'X')"
assert_eq "summary_region trims the blank lines above the marker" \
    "$expected_raw" "$region_raw"

# A code fence in the human region may quote the marker; the split must
# still happen at the first occurrence, not the last.
body_with_fenced_marker=$(printf '%s\n' \
    '## Summary' \
    '' \
    'The generated body looks like this:' \
    '' \
    '```markdown' \
    "$MARKER" \
    '```' \
    '' \
    "$MARKER" \
    '' \
    '## Features' \
    '' \
    '- feat: show the thumbnail strip')

fenced_region=$(summary_region "$body_with_fenced_marker")

assert_eq "summary_region splits at the first marker occurrence" \
    '## Summary

The generated body looks like this:

```markdown' \
    "$fenced_region"
assert_not_contains "summary_region keeps the changelog out of a fenced body" \
    "$fenced_region" '## Features'

body_without_marker=$(printf '%s\n' \
    '## Features' \
    '' \
    '- feat: show the thumbnail strip')

assert_eq "summary_region returns empty for a marker-less body" \
    '' \
    "$(summary_region "$body_without_marker")"

# --- summary_is_unwritten ---------------------------------------------------

assert_unwritten "empty summary is unwritten" ''
assert_unwritten "whitespace-only summary is unwritten" "$(printf '  \n\t\n')"
assert_unwritten "sentinel-bearing summary is unwritten" "$(printf '%s\n' \
    '## Summary' \
    '' \
    "$SENTINEL" \
    '_Write the release summary here._')"
assert_unwritten "the placeholder is unwritten" "$(summary_placeholder)"
assert_unwritten "a comment-only summary is unwritten" \
    "$(printf '<!-- nothing\nto see here -->\n')"

assert_written "a written summary is written" "$(printf '%s\n' \
    '## Summary' \
    '' \
    'The strip follows the cursor.')"

# The sentinel is matched as an exact comment, so prose is free to use the
# word TODO like any other word.
assert_written "prose containing the word TODO is written" "$(printf '%s\n' \
    '## Summary' \
    '' \
    'Adds a TODO note to the overlay.')"

# Deleting only the sentinel leaves the placeholder sentence, which must not
# become the release body. The sentence is spelled out literally, like the
# marker, so this checks the text a reader would see.
summary_without_sentinel=$(printf '%s\n' \
    '## Summary' \
    '' \
    '_Write the release summary here. It becomes the body of the GitHub Release.' \
    'Delete the marker comment above once written._')
assert_unwritten "the placeholder without its sentinel is unwritten" \
    "$summary_without_sentinel"
assert_written "a summary mentioning the release summary is written" "$(printf '%s\n' \
    '## Summary' \
    '' \
    'The release summary now lists the depth switcher.')"

# The placeholder round-trips through a generated body.
generated_body=$(printf '%s\n\n%s\n\n%s\n' \
    "$(summary_placeholder)" \
    "$MARKER" \
    '## Features')
assert_eq "summary_region recovers the placeholder from a generated body" \
    "$(summary_placeholder)" \
    "$(summary_region "$generated_body")"

# --- validate-release-summary.sh --------------------------------------------

if out=$(bash "${SCRIPT_DIR}/validate-release-summary.sh" "$generated_body" 2>&1); then
    fail "validate-release-summary.sh rejects the placeholder" "  passed: ${out}"
else
    pass "validate-release-summary.sh rejects the placeholder"
fi

body_without_sentinel=$(printf '%s\n\n%s\n\n%s\n' \
    "$summary_without_sentinel" \
    "$MARKER" \
    '## Features')
if out=$(bash "${SCRIPT_DIR}/validate-release-summary.sh" "$body_without_sentinel" 2>&1); then
    fail "validate-release-summary.sh rejects the placeholder without its sentinel" "  passed: ${out}"
else
    pass "validate-release-summary.sh rejects the placeholder without its sentinel"
fi
# The error must say what is still wrong when only the sentinel was deleted:
# the placeholder text has to be replaced, not just the comment removed.
assert_contains "the error for a kept placeholder says to replace the placeholder text" \
    "$out" "::error::The release PR has no release summary. Above the '${MARKER}' marker in the PR body, replace the placeholder text (starting '_Write the release summary here. It becomes the body of the GitHub Release.') with a summary of what changed for users, and delete the '${SENTINEL}' comment if it is still there."

if out=$(bash "${SCRIPT_DIR}/validate-release-summary.sh" "$(printf '\n\n%s\n\n## Features\n' "$MARKER")" 2>&1); then
    fail "validate-release-summary.sh rejects an empty summary" "  passed: ${out}"
else
    pass "validate-release-summary.sh rejects an empty summary"
fi

if out=$(bash "${SCRIPT_DIR}/validate-release-summary.sh" "$body_with_marker" 2>&1); then
    pass "validate-release-summary.sh accepts a written summary"
else
    fail "validate-release-summary.sh accepts a written summary" "  failed: ${out}"
fi

# --- regenerate_release_pr_body ---------------------------------------------

written_summary=$(printf '%s\n' \
    '## Summary' \
    '' \
    'The depth view now opens from both bottom corners.' \
    '' \
    '```' \
    '...release/v3)' \
    '```')
old_body=$(render_release_pr_body "$written_summary" \
    "$(printf '## Features\n\n- feat: old entry\n')" \
    "$(compare_section https://github.com/x7c1/zatto v2 3 release/v3)")

new_changelog=$(printf '## Bug Fixes\n\n- fix: new entry\n')
new_compare=$(compare_section https://github.com/x7c1/zatto v2 3 release/v3)
new_body=$(regenerate_release_pr_body "$old_body" "$new_changelog" "$new_compare")

assert_eq "regeneration preserves the hand-written summary verbatim" \
    "$written_summary" "$(summary_region "$new_body")"
assert_contains "regeneration writes the new changelog" "$new_body" '- fix: new entry'
assert_not_contains "regeneration drops the old changelog" "$new_body" '- feat: old entry'
assert_contains "regeneration keeps the marker" "$new_body" "$MARKER"
assert_contains "regeneration writes the compare link" "$new_body" \
    '- [v2...v3](https://github.com/x7c1/zatto/compare/v2...release/v3)'

assert_eq "regenerating twice is stable" \
    "$new_body" "$(regenerate_release_pr_body "$new_body" "$new_changelog" "$new_compare")"

fresh_body=$(regenerate_release_pr_body '' "$new_changelog" '')
assert_eq "regenerating a body with no summary starts from the placeholder" \
    "$(summary_placeholder)" "$(summary_region "$fresh_body")"
assert_unwritten "a fresh body's summary is unwritten" "$(summary_region "$fresh_body")"

assert_eq "compare_section is empty with no tag" \
    '' "$(compare_section https://github.com/x7c1/zatto '' 1 release/v1)"

# --- rewrite_compare_link ---------------------------------------------------

rewritten=$(rewrite_compare_link "$new_body" release/v3 3)
assert_contains "rewrite_compare_link points the link at the tag" "$rewritten" \
    '- [v2...v3](https://github.com/x7c1/zatto/compare/v2...v3)'
assert_eq "rewrite_compare_link leaves the summary untouched" \
    "$written_summary" "$(summary_region "$rewritten")"

if [ "$failures" -ne 0 ]; then
    printf '\n%d test(s) failed.\n' "$failures"
    exit 1
fi

printf '\nAll release-summary tests passed.\n'
