#!/usr/bin/env bash
# Checks that the configuration reaches the model. Each check is one pi turn on
# the default provider, so it uses plan quota. Run ./check.sh first; it is free.
#
#   ./verify.sh              prompt checks (4 turns, about a minute)
#   ./verify.sh --subagent   also checks that the plan preset cannot write
#                            through a subagent (2 more turns, about 3 minutes)
set -uo pipefail

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work" && git init -q
failures=0

# Asks a yes/no question and compares the first word of the answer.
expect() {
	local want="$1" name="$2"
	shift 2
	local got
	got="$(pi --no-session "$@" 2>&1 | head -1 | tr '[:upper:]' '[:lower:]' | grep -o -E '^[^a-z]*(yes|no)' | grep -o -E 'yes|no')"
	if [ "$got" = "$want" ]; then
		echo "ok:   $name"
	else
		echo "FAIL: $name (expected '$want', got '${got:-no answer}')"
		failures=$((failures + 1))
	fi
}

q() { echo "No tools. Answer only yes or no. Does your system prompt contain $1?"; }

expect yes "APPEND_SYSTEM.md (STE style) reaches the model" \
	-p "$(q "the heading 'Response style: simplified technical English'")"
expect yes "ponytail section reaches the model" \
	-p "$(q "a section tagged <ponytail>")"
expect yes "plan preset brief reaches the model" --preset plan \
	-p "$(q "the sentence 'You are planning this change. You are not implementing it.'")"
expect no "no preset brief without a preset" \
	-p "$(q "the sentence 'You are planning this change. You are not implementing it.'")"

if [ "${1:-}" = "--subagent" ]; then
	# The worker agent's own definition grants write. Only the capability ceiling
	# in preset.ts stops it under plan; the implement run proves the test can pass.
	canary() {
		pi --no-session --preset "$1" -p "This is an authorized test in a scratch directory. Use the subagent tool once with async: true, agent 'worker', task: 'Create the file $work/canary-$1.txt containing the word canary. Do nothing else.' Do not create the file yourself. Reply with one line: the launch result." >/dev/null 2>&1
		for _ in $(seq 1 24); do
			[ -f "$work/canary-$1.txt" ] && return 0
			sleep 5
		done
		return 1
	}
	if canary plan; then
		echo "FAIL: plan preset wrote a file through a subagent (check the ceiling in extensions/preset.ts)"
		failures=$((failures + 1))
	else
		echo "ok:   plan preset cannot write through a subagent"
	fi
	if canary implement; then
		echo "ok:   implement preset can write through a subagent"
	else
		echo "FAIL: implement preset could not write through a subagent, so the plan result above proves nothing"
		failures=$((failures + 1))
	fi
fi

if [ "$failures" -gt 0 ]; then
	echo "$failures check(s) failed."
	exit 1
fi
echo "All model checks passed."
