#!/usr/bin/env bash
set -euo pipefail

# Validate a release PR title against the branch's metadata.json version and
# the last release tag.
#
# Usage:
#   validate-release-pr-title.sh <pr_title> <metadata_file> <last_tag>
#
# Arguments:
#   pr_title      - the pull-request title (e.g. "Release v3")
#   metadata_file - the branch's dist/metadata.json
#   last_tag      - the previous release tag (e.g. "v2"); empty when nothing
#                   has been released yet, in which case the title must be
#                   "Release v1".
#
# The rules live in validate_release_title (release-version.sh), which
# release-version.test.sh covers.
#
# Exit codes:
#   0 - the title is valid
#   1 - the title is invalid (a `::error::` line is printed)
#   2 - usage error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-version.sh
source "${SCRIPT_DIR}/release-version.sh"

if [ "$#" -ne 3 ]; then
    echo "Usage: validate-release-pr-title.sh <pr_title> <metadata_file> <last_tag>" >&2
    exit 2
fi

metadata=$(metadata_version "$2")
validate_release_title "$1" "$metadata" "$3"
