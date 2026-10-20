#!/usr/bin/env bash
# Links this repository into pi's agent directory and installs what the
# configuration depends on. Safe to re-run: every step skips what is already in
# place, and nothing is upgraded. Run ./check.sh afterwards.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
SKILLS_DIR="$HOME/.agents/skills"
BACKUP_DIR="$HOME/.pi/agent-removed/pi-config-backup-$(date +%Y%m%d-%H%M%S)"

skipped=()

need() {
	command -v "$1" >/dev/null 2>&1 || {
		echo "error: '$1' is not on PATH. $2" >&2
		exit 1
	}
}

# An optional tool that is missing skips its step and is reported at the end.
want() {
	command -v "$1" >/dev/null 2>&1 && return 0
	skipped+=("$1 not found, so its step was skipped. $2")
	return 1
}

need node "Install Node.js 22 or later (this machine uses mise: mise use -g node@lts)."
need npx "npx ships with Node.js; reinstall Node.js."
need git "Install git (xcode-select --install, or brew install git)."
need pi "Install pi: npm install -g @earendil-works/pi-coding-agent"
need claude "pi-claude-bridge runs the Claude Code CLI. Install Claude Code, then run 'claude' once to log in."

echo "==> Linking $REPO/agent into $AGENT_DIR"
while IFS= read -r rel; do
	rel="${rel#./}"
	src="$REPO/agent/$rel"
	dst="$AGENT_DIR/$rel"
	if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
		continue
	fi
	if [ -e "$dst" ] || [ -L "$dst" ]; then
		mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
		mv "$dst" "$BACKUP_DIR/$rel"
		echo "    backed up $rel"
	fi
	mkdir -p "$(dirname "$dst")"
	ln -s "$src" "$dst"
	echo "    linked $rel"
done < <(cd "$REPO/agent" && find . -type f ! -name .DS_Store | sort)

echo "==> pi packages (from settings.json)"
pi_list="$(pi list 2>/dev/null || true)"
while IFS= read -r source; do
	# `pi list` prints each source, then its install path on the next line.
	path="$(awk -v want="  $source" '$0 == want { getline; sub(/^ +/, ""); print; exit }' <<<"$pi_list")"
	if [ -n "$path" ] && [ -e "$path" ]; then
		continue
	fi
	echo "    installing $source"
	pi install "$source"
done < <(node -e '
	const settings = require(process.argv[1]);
	for (const p of settings.packages ?? []) console.log(typeof p === "string" ? p : p.source);
' "$AGENT_DIR/settings.json")

echo "==> rtk extension"
if want rtk "Install it with 'brew install rtk', then re-run."; then
	[ -f "$AGENT_DIR/extensions/rtk.ts" ] || rtk init -g --agent pi
fi

echo "==> graphify skill"
if want graphify "Install it with 'uv tool install graphifyy', then re-run."; then
	[ -f "$AGENT_DIR/skills/graphify/SKILL.md" ] || graphify install --platform pi
fi

echo "==> Shared skills (from skills.txt)"
while read -r source names; do
	case "$source" in "" | \#*) continue ;; esac
	missing=()
	for name in $names; do
		[ -f "$SKILLS_DIR/$name/SKILL.md" ] || missing+=("$name")
	done
	[ ${#missing[@]} -eq 0 ] && continue
	echo "    $source: ${missing[*]}"
	npx --yes skills add "$source" -g -a pi -s "${missing[@]}" -y
done <"$REPO/skills.txt"

echo "==> chunk-sidecar skill"
if want chunk "Install CircleCI's chunk CLI, then re-run."; then
	[ -f "$SKILLS_DIR/chunk-sidecar/SKILL.md" ] || chunk skill install
fi

echo "==> Pre-commit secret scan"
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
	git -C "$REPO" config core.hooksPath .githooks
else
	skipped+=("$REPO is not a git repository, so the pre-commit hook is off. Run 'git init', then re-run.")
fi

if [ -d "$BACKUP_DIR" ]; then
	echo "Replaced files were moved to $BACKUP_DIR"
fi
for line in "${skipped[@]+"${skipped[@]}"}"; do
	echo "warning: $line" >&2
done
echo "Done. Run ./check.sh to confirm, and ./verify.sh to test against the model."
