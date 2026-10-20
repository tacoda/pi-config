#!/usr/bin/env bash
# Fails if the repository holds a credential. Credentials live in pi's auth.json
# and the environment, never here. Run by check.sh and the pre-commit hook.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATTERN='ctx7sk-|sk-ant-|sk-proj-|sk-[A-Za-z0-9]{32,}|ghp_|gho_|github_pat_|xox[abp]-|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|"(access|refresh)_token"'
status=0

# pi writes these into its agent directory; none of them belongs in git.
for name in auth.json models-store.json trust.json; do
	if [ -n "$(cd "$REPO" && git ls-files -- "agent/$name" 2>/dev/null)" ] || [ -e "$REPO/agent/$name" ]; then
		echo "FAIL: agent/$name is in the repository"
		echo "      fix: git rm --cached agent/$name, then move it back to ~/.pi/agent"
		status=1
	fi
done

hits="$(grep -rIln -E "$PATTERN" "$REPO" --exclude-dir=.git --exclude=scan-secrets.sh)"
if [ -n "$hits" ]; then
	echo "FAIL: these files look like they hold a credential:"
	echo "$hits" | sed 's/^/      /'
	echo "      fix: move the value to pi auth (/login) or an env var, and reference it as \${NAME}"
	status=1
fi

exit "$status"
