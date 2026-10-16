#!/usr/bin/env bash
set -uo pipefail

# Tests for package-extension.sh: the zip of a release build carries what
# GNOME Shell needs to load the extension and its settings.
#
# Usage:
#   bash package-extension.test.sh
#
# Copies the working tree (tracked files and untracked ones git does not
# ignore, so uncommitted changes count) into a temporary git repository,
# runs `npm run build:release` and package-extension.sh there, and lists
# the zip. The checkout's own dist/ is not touched. Needs npm, zip, unzip,
# jq and glib-compile-schemas, as the build and the packaging do.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

failures=0
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

pass() {
    printf 'ok   - %s\n' "$1"
}

fail() {
    printf 'FAIL - %s\n' "$1"
    printf '%s\n' "$2"
    failures=$((failures + 1))
}

# Stage the working tree, without node_modules (symlinked) or build output.
(
    cd "$REPO_ROOT" &&
        git ls-files -z --cached --others --exclude-standard |
        while IFS= read -r -d '' f; do
            [ -e "$f" ] && printf '%s\0' "$f"
        done |
        tar --null -T - -cf - | tar -xf - -C "$workdir"
) || {
    echo "FAIL - could not copy the working tree" >&2
    exit 1
}
ln -s "${REPO_ROOT}/node_modules" "${workdir}/node_modules"
git -C "$workdir" init -q

uuid=$(jq -r '.uuid' "${workdir}/dist/metadata.json")
version=$(jq -r '.version' "${workdir}/dist/metadata.json")
zip_file="${workdir}/${uuid}.v${version}.shell-extension.zip"

if ! output=$(cd "$workdir" && npm run build:release 2>&1); then
    fail "npm run build:release succeeds" "$output"
elif ! output=$(cd "$workdir" && bash .github/scripts/package-extension.sh "$uuid" "$version" 2>&1); then
    fail "package-extension.sh succeeds" "$output"
else
    listing=$(unzip -Z1 "$zip_file")
    for entry in metadata.json extension.js prefs.js \
        schemas/org.gnome.shell.extensions.zatto.gschema.xml \
        schemas/gschemas.compiled; do
        if grep -qxF -- "$entry" <<< "$listing"; then
            pass "the zip contains ${entry}"
        else
            fail "the zip contains ${entry}" "  zip listing:
${listing}"
        fi
    done
fi

if [ "$failures" -ne 0 ]; then
    printf '\n%d test(s) failed.\n' "$failures"
    exit 1
fi
printf '\nAll package-extension tests passed.\n'
