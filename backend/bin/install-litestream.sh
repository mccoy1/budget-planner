#!/usr/bin/env bash
# Build step on Render: fetch the pinned Litestream release into bin/litestream
# and refuse to continue unless its checksum matches.
#
# To upgrade, change VERSION and SHA256 together. The checksum comes from the
# release's checksums.txt (or the asset's "digest" in the GitHub API), for
# the linux-x86_64 tarball, which is what Render's build hosts run.
set -euo pipefail

VERSION=0.5.17
SHA256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d
ASSET="litestream-${VERSION}-linux-x86_64.tar.gz"

cd "$(dirname "$0")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/$ASSET" "https://github.com/benbjohnson/litestream/releases/download/v${VERSION}/${ASSET}"
echo "${SHA256}  $tmp/$ASSET" | sha256sum -c -
tar -xzf "$tmp/$ASSET" -C "$tmp"
install -m 0755 "$tmp/litestream" ./litestream
./litestream version
