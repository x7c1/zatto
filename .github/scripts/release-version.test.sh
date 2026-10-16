#!/usr/bin/env bash
set -uo pipefail

# Unit tests for release-version.sh.
#
# Usage:
#   bash release-version.test.sh
#
# Offline: metadata.json fixtures are written to a temporary directory, and
# the last tag is passed in as the callers pass it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-version.sh
source "${SCRIPT_DIR}/release-version.sh"

failures=0
fixtures=$(mktemp -d)
trap 'rm -rf "$fixtures"' EXIT

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

# Runs the command and asserts it succeeds.
assert_ok() {
    local name="$1"
    shift
    local output
    if output=$("$@" 2>&1); then
        pass "$name"
    else
        fail "$name" "  expected success, got failure: ${output}"
    fi
}

# Runs the command and asserts it fails with a `::error::` line.
assert_rejected() {
    local name="$1"
    shift
    local output
    if output=$("$@" 2>&1); then
        fail "$name" "  expected failure, got success: ${output}"
    elif [[ "$output" != *'::error::'* ]]; then
        fail "$name" "  failed without an ::error:: line: ${output}"
    else
        pass "$name"
    fi
}

write_metadata() {
    local file="$1" version="$2"
    printf '{\n  "uuid": "zatto@x7c1.github.io",\n  "version": %s\n}\n' "$version" > "$file"
}

# --- metadata_version / next_version ---------------------------------------

write_metadata "${fixtures}/unreleased.json" 0
write_metadata "${fixtures}/v4.json" 4
printf '{ "version": "1.2.0" }\n' > "${fixtures}/semver.json"

assert_eq "metadata_version reads the integer version" \
    4 "$(metadata_version "${fixtures}/v4.json")"
assert_rejected "metadata_version rejects a semver version" \
    metadata_version "${fixtures}/semver.json"

assert_eq "next_version of an unreleased extension is 1" \
    1 "$(next_version "$(metadata_version "${fixtures}/unreleased.json")")"
assert_eq "next_version of v4 is 5" \
    5 "$(next_version "$(metadata_version "${fixtures}/v4.json")")"
assert_eq "next_version passes 9 -> 10 numerically" \
    10 "$(next_version 9)"
assert_rejected "next_version rejects a non-integer" next_version "1.0.0"

assert_eq "the standalone 'next' command reads metadata.json" \
    5 "$(bash "${SCRIPT_DIR}/release-version.sh" next "${fixtures}/v4.json")"

# --- tag_version / release_pending -----------------------------------------

assert_eq "tag_version of no tag is 0" 0 "$(tag_version '')"
assert_eq "tag_version of v12 is 12" 12 "$(tag_version v12)"
assert_rejected "tag_version rejects a semver tag" tag_version v1.0.0

assert_ok "a merged but untagged release is pending" release_pending 3 v2
assert_ok "the first merged release is pending before its tag" release_pending 1 ''
if release_pending 2 v2; then
    fail "a tagged release is not pending" "  release_pending 2 v2 succeeded"
else
    pass "a tagged release is not pending"
fi
if release_pending 0 ''; then
    fail "an unreleased extension is not pending" "  release_pending 0 '' succeeded"
else
    pass "an unreleased extension is not pending"
fi

# --- validate_release_title ------------------------------------------------

assert_ok "accepts Release v<last tag + 1>" \
    validate_release_title "Release v3" 3 v2
assert_ok "accepts Release v1 with no tag" \
    validate_release_title "Release v1" 1 ''
assert_rejected "rejects a skipped number" \
    validate_release_title "Release v4" 4 v2
assert_rejected "rejects the last tag's own number" \
    validate_release_title "Release v2" 2 v2
assert_rejected "rejects a first release other than v1" \
    validate_release_title "Release v2" 2 ''
assert_rejected "rejects a semver title" \
    validate_release_title "Release v3.0.0" 3 v2
assert_rejected "rejects a title without the v prefix" \
    validate_release_title "Release 3" 3 v2
assert_rejected "rejects a title with trailing text" \
    validate_release_title "Release v3 (beta)" 3 v2
assert_rejected "rejects a title not matching metadata.json" \
    validate_release_title "Release v3" 2 v2
assert_rejected "rejects a semver last tag" \
    validate_release_title "Release v3" 3 v2.0.0

write_metadata "${fixtures}/v3.json" 3
assert_ok "validate-release-pr-title.sh accepts a matching branch" \
    bash "${SCRIPT_DIR}/validate-release-pr-title.sh" "Release v3" "${fixtures}/v3.json" v2
assert_rejected "validate-release-pr-title.sh rejects a non-matching metadata.json" \
    bash "${SCRIPT_DIR}/validate-release-pr-title.sh" "Release v3" "${fixtures}/v4.json" v2

if [ "$failures" -ne 0 ]; then
    printf '\n%d test(s) failed.\n' "$failures"
    exit 1
fi

printf '\nAll release-version tests passed.\n'
