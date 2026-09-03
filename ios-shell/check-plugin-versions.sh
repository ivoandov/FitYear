#!/usr/bin/env bash
# The WEB app calls the plugins; the SHELL links their native code. `cap sync`
# reads the shell's package.json, so a version drift between the two means the
# JS calls one API and the native side implements another - which fails at
# runtime on a device, not at build time. Run before every sync.
set -euo pipefail
cd "$(dirname "$0")"
fail=0
for p in $(node -e 'console.log(Object.keys(require("./package.json").dependencies).filter(d=>d.startsWith("@capacitor")||d.startsWith("@capgo")||d.startsWith("@capacitor-community")).join(" "))'); do
  shell=$(node -e "console.log(require('./package.json').dependencies['$p'] ?? '-')")
  web=$(node -e "console.log(require('../package.json').dependencies['$p'] ?? '-')")
  if [ "$web" = "-" ]; then
    printf '  %-42s shell %-10s web (not used by the web app)\n' "$p" "$shell"
  elif [ "$shell" != "$web" ]; then
    printf '  MISMATCH %-33s shell %-10s web %s\n' "$p" "$shell" "$web"; fail=1
  else
    printf '  ok       %-33s %s\n' "$p" "$shell"
  fi
done
[ "$fail" = 0 ] && echo "versions agree" || { echo "VERSIONS DIVERGED - fix before cap sync"; exit 1; }
