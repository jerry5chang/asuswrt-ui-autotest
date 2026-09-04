#!/usr/bin/env python3
"""Build the Chrome Web Store upload zip.

Ships only what the extension needs at runtime: manifest.json, src/ and
resource/. Docs, plan.md and tools/ stay out of the package.

    python3 tools/package.py        # -> asuswrt-ui-autotest-<version>.zip
"""

import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INCLUDE_DIRS = ("src", "resource")
SKIP_SUFFIXES = (".DS_Store", ".swp", "~")


def main() -> int:
    os.chdir(ROOT)

    with open("manifest.json", encoding="utf-8") as fh:
        version = json.load(fh)["version"]

    out = f"asuswrt-ui-autotest-{version}.zip"
    if os.path.exists(out):
        os.remove(out)

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write("manifest.json")
        for top in INCLUDE_DIRS:
            for folder, _, files in os.walk(top):
                for name in sorted(files):
                    if name.endswith(SKIP_SUFFIXES):
                        continue
                    zf.write(os.path.join(folder, name))
        count = len(zf.namelist())

    print(f"{out}  ({count} files, {os.path.getsize(out) / 1024:.1f} KB)")
    print("Upload at https://chrome.google.com/webstore/devconsole")
    return 0


if __name__ == "__main__":
    sys.exit(main())
