#!/usr/bin/env bash
set -euo pipefail

# Package the built extension in dist/ into the zip GNOME Shell installs.
#
# Usage:
#   package-extension.sh <uuid> <version>
#
# Run after `npm run build:release`. Writes
# `<uuid>.v<version>.shell-extension.zip` (the name `gnome-extensions pack`
# would give it) at the repository root, with the files of dist/ at the top
# level of the archive. The compiled GSettings schema stays out: GNOME Shell
# 44 and later compile an extension's schemas on install, and
# extensions.gnome.org asks extensions that support only those versions not
# to ship the compiled file.
#
# Outputs (to $GITHUB_OUTPUT, when set):
#   filename=<zip file name>

if [ "$#" -ne 2 ]; then
    echo "Usage: package-extension.sh <uuid> <version>" >&2
    exit 2
fi

UUID="$1"
VERSION="$2"
REPO_ROOT="$(git rev-parse --show-toplevel)"
FILENAME="${UUID}.v${VERSION}.shell-extension.zip"

packaged_version=$(jq -r '.version' "${REPO_ROOT}/dist/metadata.json")
if [ "$packaged_version" != "$VERSION" ]; then
    echo "::error::dist/metadata.json carries version ${packaged_version}, not ${VERSION}." >&2
    exit 1
fi

echo "Packaging extension: ${FILENAME}"
rm -f "${REPO_ROOT}/${FILENAME}"
(cd "${REPO_ROOT}/dist" && zip -r "${REPO_ROOT}/${FILENAME}" . -x schemas/gschemas.compiled)
echo "Package created: ${FILENAME}"

echo "filename=${FILENAME}" >> "${GITHUB_OUTPUT:-/dev/null}"
