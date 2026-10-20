#!/usr/bin/env bash
# Checks that this machine matches the repository. Makes no changes, calls no
# model, and needs no network. Exits 1 if any check fails; each failure names
# the fix.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SKILLS_DIR="$HOME/.agents/skills"
failures=0

fail() {
	echo "FAIL: $1"
	echo "      fix: $2"
	failures=$((failures + 1))
}

for cmd in node npx git pi claude rtk graphify; do
	command -v "$cmd" >/dev/null 2>&1 || fail "'$cmd' is not on PATH" "see the prerequisites in README.md"
done

while IFS= read -r rel; do
	rel="${rel#./}"
	src="$REPO/agent/$rel"
	dst="$AGENT_DIR/$rel"
	if [ ! -L "$dst" ] || [ "$(readlink "$dst")" != "$src" ]; then
		fail "$dst is not a link to $src" "./install.sh"
	fi
done < <(cd "$REPO/agent" && find . -type f ! -name .DS_Store | sort)

while IFS= read -r json; do
	node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' "$json" 2>/dev/null ||
		fail "$json is not valid JSON" "fix the syntax error that 'node -e \"require(\\\"$json\\\")\"' reports"
done < <(find "$REPO/agent" -name '*.json' | sort)

pi_list="$(pi list 2>/dev/null || true)"
while IFS= read -r source; do
	path="$(awk -v want="  $source" '$0 == want { getline; sub(/^ +/, ""); print; exit }' <<<"$pi_list")"
	[ -n "$path" ] && [ -e "$path" ] || fail "pi package $source is not installed" "./install.sh, or pi install $source"
done < <(node -e '
	const settings = require(process.argv[1]);
	for (const p of settings.packages ?? []) console.log(typeof p === "string" ? p : p.source);
' "$REPO/agent/settings.json")

# preset.ts loads this module to cap subagent tools. Without it, presets remove
# the subagent tool instead, so a broken resolve shows up as a missing tool.
node -e '
	const { createRequire } = require("module");
	createRequire(process.argv[1]).resolve("pi-subagents/capability-ceiling");
' "$AGENT_DIR/npm/package.json" 2>/dev/null ||
	fail "pi-subagents/capability-ceiling does not resolve from $AGENT_DIR/npm" "pi install npm:pi-subagents"

[ -f "$AGENT_DIR/extensions/rtk.ts" ] || fail "the rtk extension is missing" "rtk init -g --agent pi"
[ -f "$AGENT_DIR/skills/graphify/SKILL.md" ] || fail "the graphify skill is missing" "graphify install --platform pi"
[ -f "$SKILLS_DIR/chunk-sidecar/SKILL.md" ] || fail "the chunk-sidecar skill is missing" "chunk skill install"

while read -r source names; do
	case "$source" in "" | \#*) continue ;; esac
	for name in $names; do
		[ -f "$SKILLS_DIR/$name/SKILL.md" ] || fail "skill $name ($source) is missing" "./install.sh"
	done
done <"$REPO/skills.txt"

"$REPO/scan-secrets.sh" || failures=$((failures + 1))

if [ "$(git -C "$REPO" config core.hooksPath 2>/dev/null)" != ".githooks" ]; then
	fail "the pre-commit secret scan is not active" "./install.sh, or git config core.hooksPath .githooks"
fi

if [ "$failures" -gt 0 ]; then
	echo "$failures check(s) failed."
	exit 1
fi
echo "All checks passed."
