#!/bin/bash
# Rebuild the gh-pages branch from main with cache-busted asset URLs.
# Usage: tools/deploy-pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="$(pwd)"

WORK=/tmp/lb-pages
VER=$(git rev-parse --short main)

git worktree remove "$WORK" --force 2>/dev/null || true
git worktree prune
git worktree add "$WORK" gh-pages

cd "$WORK"
# wipe previous static build, keep .git + .nojekyll
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name .nojekyll -exec rm -rf {} +

# copy the frontend from main
for d in index.html css js assets; do
  cp -R "$SRC/$d" .
done

# cache-bust: stamp every asset URL with the current main hash
/usr/bin/python3 - <<EOF
import re
for p in ['index.html', 'js/lb-settings.js']:
    s = open(p, encoding='utf-8').read()
    s = re.sub(r'\?v=[\w.]+', '?v=$VER', s)
    open(p, 'w', encoding='utf-8').write(s)
EOF
touch .nojekyll

git add -A
git commit -m "Pages build from main @ $VER" || echo "(no changes)"
git push origin gh-pages

cd ..
git worktree remove "$WORK" --force
echo "gh-pages deployed from main @ $VER"
