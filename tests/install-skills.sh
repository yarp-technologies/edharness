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
)
excluded_skills=(claude-api slack-gif-creator theme-factory opened-api opened-init)

for skill in "${skills[@]}"; do
    test -f "$repository/packages/cli/skills/$skill/SKILL.md"
done

dist_dir="$work_dir/dist"
home_dir="$work_dir/home"
fake_bin="$work_dir/bin"
mkdir -p "$dist_dir/skills" "$home_dir" "$fake_bin"
printf '%s\n' '#!/bin/sh' >"$dist_dir/opencode"
chmod 0755 "$dist_dir/opencode"

for skill in "${skills[@]}" "${excluded_skills[@]}"; do
    mkdir -p "$dist_dir/skills/$skill"
    printf '%s\n' "---" "name: $skill" "description: bundled test skill" "---" >"$dist_dir/skills/$skill/SKILL.md"
done

fake_continue="$work_dir/npx.continue"
remote_status="$work_dir/remote.status"
bundle_status="$work_dir/bundle.status"
fake_log="$work_dir/npx.log"
cat >"$fake_bin/nohup" <<'EOF'
#!/bin/sh
"$@"
printf '%s\n' "$?" >"$INSTALL_STATUS"
EOF
printf '%s\n' \
    '#!/bin/sh' \
    'printf "%s\n" "$*" >>"$FAKE_LOG"' \
    'for _ in $(seq 1 1000); do' \
    '    test -f "$FAKE_CONTINUE" && exit 0' \
    '    sleep 0.01' \
    'done' \
    'exit 1' \
    >"$fake_bin/npx"
chmod 0755 "$fake_bin/npx" "$fake_bin/nohup"

wait_for_file() {
    for _ in $(seq 1 1000); do
        test -s "$1" && return
        sleep 0.01
    done
    printf 'install-skills: timed out waiting for %s\n' "$1" >&2
    return 1
}

FAKE_CONTINUE="$fake_continue" FAKE_LOG="$fake_log" INSTALL_STATUS="$remote_status" \
    HOME="$home_dir" PATH="$fake_bin:/usr/bin:/bin" SHELL=/bin/bash \
    bash "$repository/install" --binary "$dist_dir/opencode"

wait_for_file "$fake_log"
test ! -e "$remote_status"
grep -Fq -- '--global' "$fake_log"
grep -Fq -- '--agent *' "$fake_log"
grep -Fq -- 'algorithmic-art' "$fake_log"

touch "$fake_continue"
wait_for_file "$remote_status"
test "$(cat "$remote_status")" = 0

grep -Fq -- 'writing-skills' "$fake_log"

rm "$fake_bin/npx"
bundle_home="$work_dir/bundle-home"
INSTALL_STATUS="$bundle_status" HOME="$bundle_home" PATH="$fake_bin:/usr/bin:/bin" SHELL=/bin/bash \
    bash "$repository/install" --binary "$dist_dir/opencode"

wait_for_file "$bundle_status"
test "$(cat "$bundle_status")" = 0

for skill in "${skills[@]}"; do
    test -f "$bundle_home/.agents/skills/$skill/SKILL.md"
done

result=0
for skill in "${excluded_skills[@]}"; do
    if grep -Fq -- "$skill" "$fake_log"; then
        printf 'install-skills: excluded skill was requested: %s\n' "$skill" >&2
        result=1
    fi
    if test -e "$bundle_home/.agents/skills/$skill"; then
        printf 'install-skills: excluded bundled skill was installed: %s\n' "$skill" >&2
        result=1
    fi
done
if grep -Fq -- 'yarp-technologies/opened-skill' "$fake_log"; then
    printf '%s\n' 'install-skills: retired OpenEd source was requested' >&2
    result=1
fi
test "$result" = 0

printf '%s\n' 'install-skills: pass'
