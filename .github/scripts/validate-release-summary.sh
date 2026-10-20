#!/usr/bin/env bash
set -euo pipefail

# Fail when a release PR body carries no hand-written summary.
#
# Usage:
#   validate-release-summary.sh <pr_body>
#   validate-release-summary.sh < pr_body
#
# The summary region is what the Release workflow publishes as the GitHub
# Release body, so a release must not be merged without it. The body layout
# is documented in docs/guides/release.md.
#
# Exit codes:
#   0 — a summary is present
#   1 — the marker is missing, or the summary is missing or still unwritten
#       (a `::error::` line is printed)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-summary.sh
source "${SCRIPT_DIR}/release-summary.sh"

main() {
    local body summary

    if [ "$#" -ge 1 ]; then
        body="$1"
    else
        body="$(cat)"
    fi

    # Without the marker nothing in the body counts as the summary, and the
    # next regeneration starts the body over from the placeholder.
    if [[ "$body" != *"$(changelog_marker)"* ]]; then
        printf '::error::%s\n' "The release PR body lacks the '$(changelog_marker)' marker line, so its text is not read as the release summary, and the next push to main would replace the whole body. Put the marker back on a line of its own below your summary. See docs/guides/release.md."
        return 1
    fi

    summary=$(summary_region "$body")

    if summary_is_unwritten "$summary"; then
        printf '::error::%s\n' "The release PR has no release summary. $(unwritten_summary_fix) See docs/guides/release.md."
        return 1
    fi

    echo "OK: the release PR carries a summary."
}

main "$@"
