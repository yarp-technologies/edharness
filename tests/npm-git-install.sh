#!/usr/bin/env bash

set -euo pipefail

repository=${1:?usage: npm-git-install.sh REPOSITORY}
work_dir=$(mktemp -d)
trap 'rm -r "$work_dir"' EXIT HUP INT TERM
source_dir="$work_dir/source"
fake_bin="$work_dir/fake-bin"
prefix="$work_dir/prefix"
mkdir -p "$source_dir/bin" "$source_dir/script" "$source_dir/packages/cli/skills" "$fake_bin" "$work_dir/home"
cp "$repository/package.json" "$source_dir/package.json"
cp "$repository/bun.lock" "$source_dir/bun.lock"
cp "$repository/.gitignore" "$source_dir/.gitignore"
printf '%s\n' 'first' > "$source_dir/build-version"
if test -f "$repository/script/npm-lifecycle.cjs"; then
    cp "$repository/script/npm-lifecycle.cjs" "$source_dir/script/"
fi
if test -f "$repository/bin/edharness.cjs"; then
    cp "$repository/bin/edharness.cjs" "$source_dir/bin/"
fi
cp -R "$repository/packages/cli/skills/opened-api" "$repository/packages/cli/skills/opened-init" "$source_dir/packages/cli/skills/"

cat > "$fake_bin/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --version ]]; then
    printf '%s\n' '1.4.4'
    exit 0
fi
if [[ "${1:-}" == install ]]; then
    if [[ "${FAKE_BUN_RUNNING:-}" == 1 ]]; then
        printf '%s\n' 'recursive Bun installation' >&2
        exit 1
    fi
    mkdir -p node_modules/husky
    printf '%s\n' 'process.exit(0)' > node_modules/husky/bin.js
    FAKE_BUN_RUNNING=1 npm_lifecycle_event=postinstall node script/npm-lifecycle.cjs
    FAKE_BUN_RUNNING=1 npm_lifecycle_event=prepare node script/npm-lifecycle.cjs
    exit 0
fi
if [[ "${1:-}" == run ]]; then
    if [[ "${3:-}" == packages/core ]]; then touch core-postinstall.ok; exit 0; fi
    test "${OPENCODE_CLI_NAME:-}" = edharness
    output="packages/cli/dist/cli-${OPENCODE_TARGET}/bin"
    mkdir -p "$output"
    cp -R packages/cli/skills "$output/skills"
    cat > "$output/opencode" <<'BINARY'
#!/usr/bin/env bash
if [[ "${1:-}" == terminate ]]; then kill -TERM "$$"; fi
printf 'args=%s\n' "$*"
printf 'skills=%s\n' "$OPENCODE_BUNDLED_SKILLS"
printf 'updates=%s\n' "$OPENCODE_DISABLE_AUTOUPDATE"
BINARY
    printf 'printf "build=%%s\\n" %q\n' "$(cat build-version)" >> "$output/opencode"
    chmod 0755 "$output/opencode"
    exit 0
fi
exit 1
EOF
chmod 0755 "$fake_bin/bun"

git -C "$source_dir" init -q -b main
git -C "$source_dir" add .
git -C "$source_dir" -c user.name=Test -c user.email=test@example.invalid commit -qm fixture

mkdir -p "$source_dir/node_modules/husky"
printf '%s\n' 'require("node:fs").writeFileSync("husky-prepare.ok", "ok")' > "$source_dir/node_modules/husky/bin.js"
(
    cd "$source_dir"
    PATH="$fake_bin:$PATH" BUN_WHICH_IGNORE_CWD="$source_dir" npm_config_user_agent='npm/11.19.0' \
        npm_execpath=/not/bun npm_lifecycle_event=postinstall node script/npm-lifecycle.cjs
    PATH="$fake_bin:$PATH" BUN_WHICH_IGNORE_CWD="$source_dir" npm_config_user_agent='npm/11.19.0' \
        npm_execpath=/not/bun npm_lifecycle_event=prepare node script/npm-lifecycle.cjs
)
test -f "$source_dir/core-postinstall.ok"
test -f "$source_dir/husky-prepare.ok"

HOME="$work_dir/home" npm_config_cache="$work_dir/npm-cache" PATH="$fake_bin:$PATH" \
    npm install --global --prefix "$prefix" --install-links --no-audit --no-fund "git+file://$source_dir#main"

output=$(HOME="$work_dir/home" "$prefix/bin/edharness" --version)
expected_skills="$prefix/lib/node_modules/edharness/bin/skills"
[[ "$output" == *'args=--version'* ]]
[[ "$output" == *'build=first'* ]]
[[ "$output" == *"skills=$expected_skills"* ]]
[[ "$output" == *'updates=1'* ]]
test -f "$expected_skills/opened-api/SKILL.md"
test -f "$expected_skills/opened-init/SKILL.md"

output=$(HOME="$work_dir/home" OPENCODE_BUNDLED_SKILLS="$work_dir/custom" "$prefix/bin/edharness" check)
[[ "$output" == *"skills=$work_dir/custom"* ]]
HOME="$work_dir/home" node -e '
  const result = require("node:child_process").spawnSync(process.argv[1], ["terminate"], { timeout: 5000 })
  if (result.error || result.signal !== "SIGTERM") process.exit(1)
' "$prefix/bin/edharness"

printf '%s\n' 'second' > "$source_dir/build-version"
git -C "$source_dir" add build-version
git -C "$source_dir" -c user.name=Test -c user.email=test@example.invalid commit -qm update
HOME="$work_dir/home" npm_config_cache="$work_dir/npm-cache" PATH="$fake_bin:$PATH" \
    npm install --global --prefix "$prefix" --install-links --no-audit --no-fund "git+file://$source_dir#main"
output=$(HOME="$work_dir/home" "$prefix/bin/edharness" --version)
[[ "$output" == *'build=second'* ]]
printf '%s\n' 'npm-git-install: pass'
