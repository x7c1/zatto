#!/usr/bin/env bash
# Locate the merged release PR for a version.
#
# Usage:
#   source release-pr-lookup.sh
#   pr_number=$(find_release_pr "$version")
#
# Or standalone:
#   bash release-pr-lookup.sh <version>
#
# Two callers need the same lookup: update-release-pr-links.sh rewrites the
# merged PR's compare link, and release.yml reads the PR body to publish its
# summary region as the GitHub Release body. Echoes nothing when no merged
# release PR matches; each caller decides whether that is fatal.
#
# The search narrows the candidates and the exact title match picks one, so
# `Release v1` never resolves to `Release v10`.
#
# Environment variables:
#   GH_TOKEN - GitHub token for API access (required).

find_release_pr() {
    local version="$1"
    gh pr list \
        --state merged \
        --search "\"Release v${version}\" in:title" \
        --json number,title \
        --jq "[.[] | select(.title == \"Release v${version}\")][0].number // empty"
}

# Allow standalone execution.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    set -euo pipefail
    find_release_pr "${1:?Usage: release-pr-lookup.sh <version>}"
fi
