#!/usr/bin/env bash
set -euo pipefail

# Create or update the release PR on every push to main.
#
# The release PR is the one open PR labelled `release`. Its title is
# `Release v<next>`, where <next> is main's dist/metadata.json version plus
# one, and its branch is main plus a single commit bumping metadata.json to
# <next>. Merging it releases v<next> (release.yml). See
# docs/guides/release.md.
#
# Behaviour:
#   - No open release PR: open `release/v<next>` from main.
#   - An open release PR: rebuild its head branch from the latest main,
#     re-apply the bump, force-push, and regenerate the body. The branch
#     name is read from the PR, so the PR keeps following the same branch.
#   - A release merged but not tagged yet (main's version is ahead of the
#     last tag): do nothing. The Release workflow cuts that tag, and the
#     next push to main opens the following release PR.
#
# The body keeps the hand-written summary region verbatim and regenerates
# everything below the marker (release-summary.sh). The title is checked
# with the same rule the `Validate Release PR` check applies, so the bot
# never opens a PR that check would reject.
#
# Environment variables:
#   GH_TOKEN - token for the GitHub CLI (required; RELEASE_PAT in CI).
#
# Outputs to GITHUB_OUTPUT (when set):
#   pr_number - the PR number (new or existing); empty when skipped.
#   action    - "created", "updated" or "skipped".

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=generate-changelog.sh
source "${SCRIPT_DIR}/generate-changelog.sh"
# shellcheck source=release-summary.sh
source "${SCRIPT_DIR}/release-summary.sh"
# shellcheck source=release-version.sh
source "${SCRIPT_DIR}/release-version.sh"

REPO_ROOT="$(git rev-parse --show-toplevel)"
METADATA_FILE="${REPO_ROOT}/dist/metadata.json"

main() {
    local pr_number last_tag current_version next_version repo_url branch changelog

    if [ -z "${GH_TOKEN:-}" ]; then
        echo "::error::GH_TOKEN is empty. The workflow passes the RELEASE_PAT repository secret; see docs/guides/release.md." >&2
        exit 1
    fi

    last_tag=$(get_last_tag)
    current_version=$(metadata_version "$METADATA_FILE")

    if release_pending "$current_version" "$last_tag"; then
        echo "main carries v${current_version}, which has no tag yet (last tag: ${last_tag:-none}); the Release workflow cuts it. Skipping."
        emit_output "pr_number" ""
        emit_output "action" "skipped"
        return 0
    fi

    next_version=$(next_version "$current_version")
    pr_number=$(find_existing_pr)
    repo_url=$(gh repo view --json url --jq '.url')

    if [ -n "$pr_number" ]; then
        branch=$(gh pr view "$pr_number" --json headRefName --jq '.headRefName')
        echo "Existing release PR #${pr_number} on ${branch}; retargeting it at v${next_version}"
    else
        branch="release/v${next_version}"
        echo "No open release PR; opening ${branch} for v${next_version}"
    fi

    changelog=$(generate_changelog "$last_tag" "$repo_url")

    if [ -n "$pr_number" ]; then
        update_release_pr "$pr_number" "$branch" "$next_version" "$last_tag" "$changelog" "$repo_url"
        emit_output "pr_number" "$pr_number"
        emit_output "action" "updated"
    else
        ensure_release_label
        create_release_pr "$branch" "$next_version" "$last_tag" "$changelog" "$repo_url"
        pr_number=$(find_existing_pr)
        emit_output "pr_number" "$pr_number"
        emit_output "action" "created"
    fi
}

find_existing_pr() {
    gh pr list --label "release" --state open --json number --jq '.[0].number // empty'
}

get_last_tag() {
    git describe --tags --abbrev=0 2>/dev/null || echo ""
}

ensure_release_label() {
    gh label create release --description "Release PR" --color 0E8A16 2>/dev/null || true
}

configure_bot_identity() {
    git config user.name "github-actions[bot]"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
}

# Check out main as `branch`, bump metadata.json to `version` and commit,
# refusing a title the `Validate Release PR` check would reject.
build_release_branch() {
    local branch="$1"
    local version="$2"
    local last_tag="$3"

    configure_bot_identity
    git fetch origin main
    git checkout -B "$branch" origin/main

    jq ".version = ${version}" "$METADATA_FILE" > "${METADATA_FILE}.tmp"
    mv "${METADATA_FILE}.tmp" "$METADATA_FILE"

    validate_release_title "Release v${version}" "$(metadata_version "$METADATA_FILE")" "$last_tag"

    git add "$METADATA_FILE"
    git commit -m "Release v${version}"
}

create_release_pr() {
    local branch="$1"
    local version="$2"
    local last_tag="$3"
    local changelog="$4"
    local repo_url="$5"
    local compare

    build_release_branch "$branch" "$version" "$last_tag"

    # A previous failed run may have left the branch behind without a PR.
    git push origin --delete "$branch" 2>/dev/null || true
    git push origin "$branch"

    compare=$(compare_section "$repo_url" "$last_tag" "$version" "$branch")
    render_release_pr_body "$(summary_placeholder)" "$changelog" "$compare" \
        | gh pr create \
            --base main \
            --head "$branch" \
            --title "Release v${version}" \
            --label "release" \
            --body-file -
}

update_release_pr() {
    local pr_number="$1"
    local branch="$2"
    local version="$3"
    local last_tag="$4"
    local changelog="$5"
    local repo_url="$6"
    local old_body compare

    # Read the body before rebuilding the branch, and check the fetch
    # explicitly: a failed API call must not read as "no summary yet", or
    # the edit below would replace a hand-written summary with the
    # placeholder.
    if ! old_body=$(gh pr view "$pr_number" --json body --jq '.body'); then
        echo "::error::Could not read the body of release PR #${pr_number}; refusing to regenerate it, as that would drop the hand-written release summary." >&2
        return 1
    fi

    build_release_branch "$branch" "$version" "$last_tag"
    git fetch origin "+refs/heads/${branch}:refs/remotes/origin/${branch}"
    git push origin "$branch" --force-with-lease="${branch}:origin/${branch}"

    compare=$(compare_section "$repo_url" "$last_tag" "$version" "$branch")
    regenerate_release_pr_body "$old_body" "$changelog" "$compare" \
        | gh pr edit "$pr_number" \
            --title "Release v${version}" \
            --body-file -
}

emit_output() {
    local key="$1"
    local value="$2"
    if [ -n "${GITHUB_OUTPUT:-}" ]; then
        echo "${key}=${value}" >> "$GITHUB_OUTPUT"
    fi
    echo "${key}=${value}"
}

main "$@"
