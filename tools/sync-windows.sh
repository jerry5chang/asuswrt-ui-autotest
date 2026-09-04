#!/usr/bin/env bash
#
# Mirror the runtime files to a Windows-local directory so Windows Chrome can
# load the extension unpacked.
#
# Chrome can technically load from \\wsl.localhost\<distro>\..., but extensions
# on a UNC path tend to get dropped on restart, so a local copy is the reliable
# route. Re-run this after editing, then press the reload arrow on
# chrome://extensions -- the target path stays the same, so the extension keeps
# its id and its stored settings.
#
#   ./tools/sync-windows.sh            # -> %LOCALAPPDATA%\asuswrt-ui-autotest
#   ./tools/sync-windows.sh /mnt/c/some/other/dir
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ $# -ge 1 ]]; then
    DEST="$1"
else
    WIN_USER="$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n')"
    if [[ -z "$WIN_USER" ]]; then
        echo "Could not read %USERNAME%; pass the destination explicitly." >&2
        exit 1
    fi
    DEST="/mnt/c/Users/${WIN_USER}/AppData/Local/asuswrt-ui-autotest"
fi

mkdir -p "$DEST"

# Delete-first so a file removed from the repo does not linger in the copy and
# get loaded by Chrome.
rm -rf "$DEST/src" "$DEST/resource" "$DEST/manifest.json"
cp manifest.json "$DEST/"
cp -r src resource "$DEST/"

COUNT="$(find "$DEST" -type f | wc -l)"
VERSION="$(grep -o '"version"[^,]*' manifest.json | head -1 | grep -o '[0-9][0-9.]*')"

echo "synced v${VERSION}: ${COUNT} files"
echo
echo "Load this path in chrome://extensions -> Load unpacked:"
echo
if command -v wslpath >/dev/null 2>&1; then
    wslpath -w "$DEST"
else
    echo "$DEST"
fi
