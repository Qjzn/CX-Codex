#!/usr/bin/env bash
set -euo pipefail

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

package_name=$(node -p "require('./package.json').name")
current_version=$(node -p "require('./package.json').version")
published_version=$(npm view "$package_name" dist-tags.latest 2>/dev/null || true)

next_version=$(node -e "
const parse = (v) => v.split('.').map((n) => Number(n));
const gt = (a, b) => {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
};
const current = parse(process.argv[1]);
const published = process.argv[2] ? parse(process.argv[2]) : [0, 0, 0];
const base = gt(current, published) ? current : published;
base[2] += 1;
console.log(base.join('.'));
" "$current_version" "$published_version")

if [[ "$next_version" != "$current_version" ]]; then
  npm version "$next_version" --no-git-tag-version
fi

npm run build
npm publish --access public
