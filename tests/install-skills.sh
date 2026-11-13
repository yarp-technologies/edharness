#!/usr/bin/env bash

set -euo pipefail

repository=${1:?usage: install-skills.sh REPOSITORY}
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

skills=(
    algorithmic-art
    brand-guidelines
    canvas-design
    doc-coauthoring
    docx
    frontend-design
    internal-comms
    mcp-builder
    pdf
    pptx
    skill-creator
    template-skill
    web-artifacts-builder
    webapp-testing
    xlsx
    brainstorming
    dispatching-parallel-agents
    executing-plans
    finishing-a-development-branch
    receiving-code-review
    requesting-code-review
    subagent-driven-development
    systematic-debugging
    test-driven-development
    using-git-worktrees
    using-superpowers
    verification-before-completion
    writing-plans
    writing-skills
    opened-api
    opened-init
)

for skill in "${skills[@]}"; do
    test -f "$repository/packages/cli/skills/$skill/SKILL.md"
done

dist_dir="$work_dir/dist"
home_dir="$work_dir/home"
fake_bin="$work_dir/bin"
mkdir -p "$dist_dir/skills" "$home_dir" "$fake_bin"
printf '%s\n' '#!/bin/sh' >"$dist_dir/opencode"
chmod 0755 "$dist_dir/opencode"

for skill in "${skills[@]}"; do
    if [[ "$skill" == opened-api || "$skill" == opened-init ]]; then
        cp -R "$repository/packages/cli/skills/$skill" "$dist_dir/skills/$skill"
    else
        mkdir -p "$dist_dir/skills/$skill"
        printf '%s\n' "---" "name: $skill" "description: bundled test skill" "---" >"$dist_dir/skills/$skill/SKILL.md"
    fi
done

fake_start="$work_dir/npx.started"
fake_done="$work_dir/npx.done"
fake_log="$work_dir/npx.log"
printf '%s\n' \
    '#!/bin/sh' \
    'printf "%s\n" "$*" >>"$FAKE_LOG"' \
    'touch "$FAKE_START"' \
    'case "$*" in *anthropics/skills*) sleep 2 ;; esac' \
    'case "$*" in *yarp-technologies/opened-skill*) touch "$FAKE_DONE" ;; esac' \
    >"$fake_bin/npx"
chmod 0755 "$fake_bin/npx"

FAKE_DONE="$fake_done" FAKE_LOG="$fake_log" FAKE_START="$fake_start" \
    HOME="$home_dir" PATH="$fake_bin:/usr/bin:/bin" SHELL=/bin/bash \
    bash "$repository/install" --binary "$dist_dir/opencode"

for _ in $(seq 1 100); do
    test -f "$fake_start" && break
    sleep 0.01
done
test -f "$fake_start"
test ! -f "$fake_done"
grep -Fq -- '--global' "$fake_log"
grep -Fq -- '--agent *' "$fake_log"
grep -Fq -- 'algorithmic-art' "$fake_log"

for _ in $(seq 1 1000); do
    test -f "$fake_done" && break
    sleep 0.01
done
test -f "$fake_done"

grep -Fq -- 'writing-skills' "$fake_log"
grep -F -- 'yarp-technologies/opened-skill' "$fake_log" | grep -Fq -- '--global --yes --agent opencode --skill opened-api opened-init'
if grep -Eq -- 'claude-api|slack-gif-creator|theme-factory' "$fake_log"; then
    printf '%s\n' 'install-skills: excluded skills were requested' >&2
    exit 1
fi

rm "$fake_bin/npx"
bundle_home="$work_dir/bundle-home"
HOME="$bundle_home" PATH="$fake_bin:/usr/bin:/bin" SHELL=/bin/bash \
    bash "$repository/install" --binary "$dist_dir/opencode"

for _ in $(seq 1 1000); do
    test -f "$bundle_home/.agents/skills/opened-init/scripts/opened-init.mjs" && break
    sleep 0.01
done
test -f "$bundle_home/.agents/skills/opened-init/scripts/opened-init.mjs"

for skill in "${skills[@]}"; do
    test -f "$bundle_home/.agents/skills/$skill/SKILL.md"
done
test -f "$bundle_home/.agents/skills/opened-api/references/api.md"
test -f "$bundle_home/.agents/skills/opened-api/scripts/opened-init.mjs"
test -f "$bundle_home/.agents/skills/opened-init/scripts/opened-init.mjs"

if test -e "$bundle_home/.agents/skills/claude-api" ||
    test -e "$bundle_home/.agents/skills/slack-gif-creator" ||
    test -e "$bundle_home/.agents/skills/theme-factory"; then
    printf '%s\n' 'install-skills: excluded bundled skills were installed' >&2
    exit 1
fi

printf '%s\n' 'install-skills: pass'
