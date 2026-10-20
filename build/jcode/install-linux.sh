#!/usr/bin/env bash
#---------------------------------------------------------------------------------------------
#  Copyright (c) Microsoft Corporation. All rights reserved.
#  Licensed under the MIT License. See License.txt in the project root for license information.
#---------------------------------------------------------------------------------------------
#
# Installs or updates JCode on Debian and Ubuntu from its GitHub Releases:
#
#   curl -fsSL https://jchnc.github.io/jcode/install.sh | bash
#
# Run it again to update. Pass --version <x.y.z> to install a specific release.
# Afterwards, run "jcode ." to open the current folder or "jcode <file>" to open a file.

set -euo pipefail

REPOSITORY="${JCODE_REPOSITORY:-Jchnc/jcode}"
API="${JCODE_RELEASES_API:-https://api.github.com/repos/$REPOSITORY/releases}"
VERSION=""

usage() {
	cat <<EOF
Install or update JCode on Debian and Ubuntu.

Usage: install.sh [--version <x.y.z>]

  --version <x.y.z>  Install this release instead of the latest one.
  --help             Show this help.

Uninstall with: sudo apt remove jcode
EOF
}

fail() {
	echo "JCode: $*" >&2
	exit 1
}

while [ $# -gt 0 ]; do
	case "$1" in
		--version) [ $# -ge 2 ] || fail "--version needs a version, for example --version 1.2.3."; VERSION="${2#v}"; shift 2 ;;
		--version=*) VERSION="${1#--version=}"; VERSION="${VERSION#v}"; shift ;;
		-h|--help) usage; exit 0 ;;
		*) fail "unknown option '$1'. Run with --help for usage." ;;
	esac
done

command -v dpkg >/dev/null && command -v apt-get >/dev/null || fail "this installer supports Debian and Ubuntu (dpkg and apt). On other distributions, use the .tar.gz from https://github.com/$REPOSITORY/releases."
command -v python3 >/dev/null || fail "python3 is required to read the release information. Install it with: sudo apt install python3"

case "$(dpkg --print-architecture)" in
	amd64) ARCH=x64 ;;
	arm64) ARCH=arm64 ;;
	*) fail "there is no JCode package for the $(dpkg --print-architecture) architecture. Packages exist for amd64 and arm64." ;;
esac

if [ "$(id -u)" -eq 0 ]; then
	SUDO=""
elif command -v sudo >/dev/null; then
	SUDO="sudo"
else
	fail "installing needs root. Run this as root or install sudo."
fi

download() {
	if command -v curl >/dev/null; then
		curl -fsSL --retry 3 -H 'Accept: application/vnd.github+json' -o "$2" "$1"
	elif command -v wget >/dev/null; then
		wget -q --tries=3 --header='Accept: application/vnd.github+json' -O "$2" "$1"
	else
		fail "curl or wget is required. Install one with: sudo apt install curl"
	fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "$VERSION" ]; then
	RELEASE_URL="$API/tags/jcode-v$VERSION"
	RELEASE_NAME="JCode $VERSION"
else
	RELEASE_URL="$API/latest"
	RELEASE_NAME="the latest JCode release"
fi

echo "Looking up $RELEASE_NAME..."
download "$RELEASE_URL" "$TMP/release.json" || fail "could not find $RELEASE_NAME at https://github.com/$REPOSITORY/releases."

# Prints the version, the package URL and its sha256 digest (if GitHub reports one), one per line.
ASSET="$(python3 - "$TMP/release.json" "$ARCH" <<'EOF'
import json, re, sys
release = json.load(open(sys.argv[1]))
pattern = re.compile(r'^JCode-linux-' + re.escape(sys.argv[2]) + r'-(.+)\.deb$')
for asset in release.get('assets', []):
	match = pattern.match(asset.get('name', ''))
	if match:
		digest = asset.get('digest') or ''
		print(match.group(1))
		print(asset['browser_download_url'])
		print(digest[len('sha256:'):] if digest.startswith('sha256:') else '')
		break
EOF
)"

[ -n "$ASSET" ] || fail "the release has no Debian package for $ARCH."
PACKAGE_VERSION="$(sed -n 1p <<<"$ASSET")"
PACKAGE_URL="$(sed -n 2p <<<"$ASSET")"
PACKAGE_SHA256="$(sed -n 3p <<<"$ASSET")"

INSTALLED="$(dpkg-query -W -f='${Status} ${Version}' jcode 2>/dev/null || true)"
case "$INSTALLED" in
	"install ok installed $PACKAGE_VERSION"*) echo "JCode $PACKAGE_VERSION is already installed."; exit 0 ;;
esac

PACKAGE="$TMP/JCode-linux-$ARCH-$PACKAGE_VERSION.deb"
echo "Downloading JCode $PACKAGE_VERSION for $ARCH..."
download "$PACKAGE_URL" "$PACKAGE" || fail "could not download $PACKAGE_URL."

if [ -n "$PACKAGE_SHA256" ]; then
	echo "$PACKAGE_SHA256  $PACKAGE" | sha256sum -c --quiet - || fail "the downloaded package does not match its published checksum. Nothing was installed."
fi

# apt resolves the package's dependencies; it reads the file as the _apt user, so make it readable.
chmod 644 "$PACKAGE"
chmod 755 "$TMP"
echo "Installing JCode $PACKAGE_VERSION..."
$SUDO apt-get install -y "$PACKAGE"

echo
echo "JCode $PACKAGE_VERSION is installed. Run \"jcode .\" to open the current folder, or \"jcode <file>\" to open a file."
echo "Run this installer again to update, or uninstall with: sudo apt remove jcode"
