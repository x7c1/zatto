#!/usr/bin/env bash
# Shared helpers for zatto's release version: a single integer.
#
# The version is the integer `version` of dist/metadata.json, as GNOME Shell
# and extensions.gnome.org require. A release `<N>` is tagged `v<N>` and its
# release PR is titled `Release v<N>`; there is no semver and no
# `version-name`. `0` in metadata.json means "not released yet", so the first
# release is v1. See docs/guides/release.md.
#
# Usage:
#   source release-version.sh
#   next=$(next_version "$(metadata_version dist/metadata.json)")
#
# Or standalone:
#   bash release-version.sh current [metadata_file]
#   bash release-version.sh next [metadata_file]
#
# Every function except metadata_version is pure text manipulation — no
# network, no git, no GitHub CLI — so release-version.test.sh can exercise
# them offline. Callers resolve the last tag themselves
# (`git describe --tags --abbrev=0`) and pass it in.

# The integer version recorded in a metadata.json file.
metadata_version() {
    local file="$1"
    local version

    version=$(jq -r '.version' "$file") || return 1
    if ! is_version "$version"; then
        echo "::error::${file} carries version '${version}', which is not a non-negative integer." >&2
        return 1
    fi
    printf '%s\n' "$version"
}

# True when the argument is a non-negative integer without leading zeros.
is_version() {
    [[ "$1" =~ ^(0|[1-9][0-9]*)$ ]]
}

# The version the next release PR carries: the current one plus one.
next_version() {
    local current="$1"

    if ! is_version "$current"; then
        echo "::error::Current version '${current}' is not a non-negative integer." >&2
        return 1
    fi
    printf '%s\n' "$((current + 1))"
}

# The version a release tag names: `v3` -> `3`. An empty tag (nothing
# released yet) names `0`.
tag_version() {
    local tag="$1"

    if [ -z "$tag" ]; then
        printf '0\n'
        return
    fi
    if [[ ! "$tag" =~ ^v(0|[1-9][0-9]*)$ ]]; then
        echo "::error::Last tag '${tag}' does not match 'v<N>'." >&2
        return 1
    fi
    printf '%s\n' "${BASH_REMATCH[1]}"
}

# True when main carries a version that has no tag yet: a release PR has been
# merged and the Release workflow has not cut its tag. No new release PR is
# opened until it has, since its number would collide with the pending one.
release_pending() {
    local current="$1"
    local last_tag="$2"
    local released

    released=$(tag_version "$last_tag") || return 2
    [ "$current" -gt "$released" ]
}

# Check a release PR title against the version on its branch and the last
# tag. Prints `OK: ...` on success and a `::error::` line on failure.
#
# Rules:
#   - The title is exactly `Release v<N>`.
#   - <N> equals the branch's metadata.json version.
#   - <N> equals the last tag's number plus one, or 1 when there is no tag.
validate_release_title() {
    local title="$1"
    local metadata="$2"
    local last_tag="$3"
    local version released expected

    if [[ ! "$title" =~ ^Release\ v(0|[1-9][0-9]*)$ ]]; then
        printf '::error::%s\n' "PR title '${title}' does not match 'Release v<N>' (an integer, e.g. 'Release v3'; no semver)."
        return 1
    fi
    version="${BASH_REMATCH[1]}"

    if [ "$version" != "$metadata" ]; then
        printf '::error::%s\n' "PR title names v${version}, but dist/metadata.json on the branch carries version ${metadata}."
        return 1
    fi

    if ! released=$(tag_version "$last_tag"); then
        return 1
    fi
    expected=$((released + 1))
    if [ "$version" -ne "$expected" ]; then
        printf '::error::%s\n' "PR title names v${version}, but the release after ${last_tag:-no tag} is v${expected}."
        return 1
    fi

    echo "OK: Release v${version} follows ${last_tag:-no tag}."
}

# Allow standalone execution.
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    set -euo pipefail
    case "${1:-}" in
        current)
            metadata_version "${2:-dist/metadata.json}"
            ;;
        next)
            next_version "$(metadata_version "${2:-dist/metadata.json}")"
            ;;
        *)
            echo "Usage: release-version.sh {current|next} [metadata_file]" >&2
            exit 2
            ;;
    esac
fi
