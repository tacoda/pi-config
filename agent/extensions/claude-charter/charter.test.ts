// Run: node --test agent/extensions/claude-charter/charter.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	type Rule,
	claudeToolCall,
	explicitlyTrusted,
	findProjectRoot,
	hooksFor,
	isAlwaysOn,
	loadCharter,
	matcherMatches,
	matchingRules,
	rulePaths,
	runHook,
	verdict,
} from "./charter.ts";

function fixture(): string {
	const root = mkdtempSync(join(tmpdir(), "claude-charter-"));
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, ".claude", "rules", "nested"), { recursive: true });
	mkdirSync(join(root, "src", "deep"), { recursive: true });
	writeFileSync(join(root, ".claude", "rules", "always.md"), "---\npaths:\n  - \"**\"\n---\n# Always\nbody");
	writeFileSync(join(root, ".claude", "rules", "plain.md"), "# No frontmatter loads every session");
	writeFileSync(join(root, ".claude", "rules", "nested", "ts.md"), "---\ndescription: x\npaths:\n  - \"src/**/*.{ts,tsx}\"\n  - 'lib/*.ts'\nlayer: project\n---\nts rule");
	writeFileSync(
		join(root, ".claude", "settings.json"),
		JSON.stringify({
			hooks: {
				PreToolUse: [
					{ matcher: "Edit|Write|MultiEdit", hooks: [{ type: "command", command: "exit 2", timeout: 5 }] },
					{ matcher: "Bash", hooks: [{ type: "command", command: "true" }, { type: "prompt", prompt: "ignored" }] },
				],
				Stop: [{ matcher: "", hooks: [{ type: "command", command: "make pre-commit" }] }],
			},
		}),
	);
	writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({ hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "true" }] }] } }));
	return root;
}

test("rulePaths reads block, flow and scalar forms, and undefined without paths", () => {
	assert.deepEqual(rulePaths("---\npaths:\n  - \"a/**\"\n  - b.md\nother: 1\n---\nx"), ["a/**", "b.md"]);
	assert.deepEqual(rulePaths("---\npaths: [\"a/**\", 'b']\n---\n"), ["a/**", "b"]);
	assert.deepEqual(rulePaths("---\npaths: src/**\n---\n"), ["src/**"]);
	assert.equal(rulePaths("---\ndescription: x\n---\n"), undefined);
	assert.equal(rulePaths("# no frontmatter"), undefined);
});

test("loadCharter splits always-on from path-scoped rules and strips frontmatter", () => {
	const root = fixture();
	const charter = loadCharter(root);
	const byRel = Object.fromEntries(charter.rules.map((rule) => [rule.rel, rule]));
	assert.equal(isAlwaysOn(byRel[".claude/rules/always.md"]), true);
	assert.equal(isAlwaysOn(byRel[".claude/rules/plain.md"]), true);
	assert.equal(isAlwaysOn(byRel[".claude/rules/nested/ts.md"]), false);
	assert.equal(byRel[".claude/rules/always.md"].body, "# Always\nbody");
});

test("matchingRules matches braces, ignores always-on rules and files outside the root", () => {
	const root = fixture();
	const { rules } = loadCharter(root);
	const names = (file: string) => matchingRules(rules, file, root).map((rule: Rule) => rule.rel);
	assert.deepEqual(names(join(root, "src/deep/a.tsx")), [".claude/rules/nested/ts.md"]);
	assert.deepEqual(names(join(root, "lib/b.ts")), [".claude/rules/nested/ts.md"]);
	assert.deepEqual(names(join(root, "src/deep/a.py")), []);
	assert.deepEqual(names("/elsewhere/src/a.ts"), []);
});

test("loadHooks merges settings and settings.local, keeps only command hooks, skips Stop", () => {
	const charter = loadCharter(fixture());
	assert.equal(hooksFor(charter, "PreToolUse", "Edit").length, 1);
	assert.equal(hooksFor(charter, "PreToolUse", "MultiEdit").length, 1);
	assert.equal(hooksFor(charter, "PreToolUse", "Bash").length, 1);
	assert.equal(hooksFor(charter, "PreToolUse", "Read").length, 0);
	assert.equal(hooksFor(charter, "PostToolUse", "Read").length, 1);
	assert.equal(hooksFor(charter, "PreToolUse", "Edit")[0].timeoutSec, 5);
	assert.equal(hooksFor(charter, "PreToolUse", "Bash")[0].timeoutSec, 60);
});

test("loadHooks throws on a broken settings file instead of dropping its guards", () => {
	const root = fixture();
	writeFileSync(join(root, ".claude", "settings.json"), "{ not json");
	assert.throws(() => loadCharter(root), /not valid JSON.*\/reload/);
});

test("matcherMatches anchors the regex and treats empty and * as match-all", () => {
	assert.equal(matcherMatches("Edit|Write", "Edit"), true);
	assert.equal(matcherMatches("Edit|Write", "MultiEdit"), false);
	assert.equal(matcherMatches("Notebook.*", "NotebookEdit"), true);
	assert.equal(matcherMatches("", "Bash"), true);
	assert.equal(matcherMatches("*", "Bash"), true);
});

test("claudeToolCall maps pi inputs to the fields Claude Code hooks read", () => {
	assert.deepEqual(claudeToolCall("edit", { path: "a.ts", edits: [{ oldText: "x", newText: "y" }] }, "/repo"), {
		tool_name: "Edit",
		tool_input: { file_path: "/repo/a.ts", old_string: "x", new_string: "y" },
	});
	const multi = claudeToolCall("edit", { path: "/abs/a.ts", edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] }, "/repo");
	assert.equal(multi?.tool_name, "MultiEdit");
	assert.deepEqual(multi?.tool_input.edits, [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }]);
	assert.deepEqual(claudeToolCall("write", { path: "b.ts", content: "z" }, "/repo")?.tool_input, { file_path: "/repo/b.ts", content: "z" });
	assert.equal(claudeToolCall("bash", { command: "ls" }, "/repo")?.tool_input.command, "ls");
	assert.equal(claudeToolCall("ask_user_question", {}, "/repo"), undefined);
});

test("runHook feeds the payload on stdin and verdict applies the exit-code contract", async () => {
	const root = fixture();
	const payload = { tool_name: "Write", tool_input: { file_path: "/repo/a.php", content: "dd($x)" } };
	const echo = await runHook({ command: "cat", timeoutSec: 5 }, payload, root);
	assert.deepEqual(JSON.parse(echo.stdout), payload);

	const blocked = await runHook({ command: "echo 'banned token' >&2; exit 2", timeoutSec: 5 }, payload, root);
	assert.deepEqual(verdict([blocked]), { block: true, ask: false, reason: "banned token", notices: [] });

	const broken = await runHook({ command: "exit 1", timeoutSec: 5 }, payload, root);
	const nonBlocking = verdict([broken]);
	assert.equal(nonBlocking.block, false);
	assert.equal(nonBlocking.notices.length, 1);

	const denied = await runHook(
		{ command: `echo '{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"no"}}'`, timeoutSec: 5 },
		payload,
		root,
	);
	assert.deepEqual(verdict([denied]), { block: true, ask: false, reason: "no", notices: [] });

	const slow = await runHook({ command: "sleep 5", timeoutSec: 0.2 }, payload, root);
	assert.equal(slow.timedOut, true);
	assert.equal(verdict([slow]).block, false);
});

test("runHook runs in the project root with CLAUDE_PROJECT_DIR set", async () => {
	const root = fixture();
	const run = await runHook({ command: 'echo "$PWD|$CLAUDE_PROJECT_DIR"', timeoutSec: 5 }, {}, root);
	const [pwd, projectDir] = run.stdout.trim().split("|");
	assert.equal(projectDir, root);
	assert.ok(pwd.endsWith(root.split("/").pop()!));
});

test("explicitlyTrusted needs an explicit true; the nearest decision wins", () => {
	const agentDir = mkdtempSync(join(tmpdir(), "agent-"));
	const root = fixture();
	assert.equal(explicitlyTrusted(root, agentDir), false);
	const real = findProjectRoot(root)!;
	writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [real]: true }));
	assert.equal(explicitlyTrusted(join(root, "src", "deep"), agentDir), true);
	writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [real]: true, [join(real, "src")]: false }));
	assert.equal(explicitlyTrusted(join(root, "src", "deep"), agentDir), false);
});

test("findProjectRoot walks up to .claude and stops at the git root", () => {
	const root = fixture();
	const real = findProjectRoot(root)!;
	assert.equal(findProjectRoot(join(root, "src", "deep")), real);
	const bare = mkdtempSync(join(tmpdir(), "no-charter-"));
	mkdirSync(join(bare, ".git"));
	assert.equal(findProjectRoot(bare), undefined);
});
