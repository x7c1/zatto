#!/usr/bin/env bash
set -euo pipefail

# Rewrite the merged release PR's compare link to the permanent tag.
#
# Usage:
#   update-release-pr-links.sh <version>
#
# While the release PR is open its tag does not exist, so the compare link
# create-release-pr.sh writes points at the release branch. Once the Release
# workflow has cut the tag, the branch can be deleted and the link goes
# stale. This script finds the merged release PR for the version, reads its
# head branch and rewrites the link to `v<version>`, below the marker only
# (rewrite_compare_link in release-summary.sh; layout: docs/guides/release.md).
#
# Environment variables:
#   GH_TOKEN - GitHub token for API access (required).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-pr-lookup.sh
source "${SCRIPT_DIR}/release-pr-lookup.sh"
# shellcheck source=release-summary.sh
source "${SCRIPT_DIR}/release-summary.sh"

main() {
    local version="$1"
    local pr_number branch body

    pr_number=$(find_release_pr "$version")
    if [ -z "$pr_number" ]; then
        echo "No merged release PR found for v${version}; nothing to rewrite."
        return 0
    fi

    branch=$(gh pr view "$pr_number" --json headRefName --jq '.headRefName')
    if [ -z "$branch" ]; then
        echo "::error::Could not read the head branch of PR #${pr_number}." >&2
        return 1
    fi

    echo "Rewriting the compare link on PR #${pr_number} (head ${branch})..."

    body=$(gh pr view "$pr_number" --json body --jq '.body')
    body=$(rewrite_compare_link "$body" "$branch" "$version")

    # printf, not echo: the body opens with hand-written text, which may
    # start with `-n` and be swallowed as an echo option.
    printf '%s\n' "$body" | gh pr edit "$pr_number" --body-file -
    echo "Done."
}

main "${1:?Usage: update-release-pr-links.sh <version>}"
