#!/usr/bin/env bash
set -euo pipefail

# Detect whether dist/metadata.json's version rose between HEAD~1 and HEAD,
# i.e. whether HEAD is the merge of a release PR. Only a rise counts: a
# commit that lowers the version (such as the one resetting it to 0 before
# the first release) has no release PR to publish.
#
# Usage:
#   check-version-change.sh [metadata_file]
#
# Outputs (to $GITHUB_OUTPUT, when set):
#   changed=true|false
#   version=<N>  - only when changed=true; the new version.
#   uuid=<uuid>  - only when changed=true; the extension's UUID.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=release-version.sh
source "${SCRIPT_DIR}/release-version.sh"

METADATA_FILE="${1:-dist/metadata.json}"
GITHUB_OUTPUT="${GITHUB_OUTPUT:-/dev/null}"

previous_file=$(mktemp)
trap 'rm -f "$previous_file"' EXIT
git show "HEAD~1:${METADATA_FILE}" > "$previous_file"

current_version=$(metadata_version "$METADATA_FILE")
previous_version=$(metadata_version "$previous_file")

echo "Current version: ${current_version}"
echo "Previous version: ${previous_version}"

if [ "$current_version" -gt "$previous_version" ]; then
    echo "Version changed from ${previous_version} to ${current_version}"
    {
        echo "changed=true"
        echo "version=${current_version}"
        echo "uuid=$(jq -r '.uuid' "$METADATA_FILE")"
    } >> "$GITHUB_OUTPUT"
elif [ "$current_version" -lt "$previous_version" ]; then
    echo "Version lowered from ${previous_version} to ${current_version}; skipping release"
    echo "changed=false" >> "$GITHUB_OUTPUT"
else
    echo "Version unchanged; skipping release"
    echo "changed=false" >> "$GITHUB_OUTPUT"
fi
