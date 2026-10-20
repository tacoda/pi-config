/**
 * Pure logic for the claude-charter extension: reading a repository's Claude
 * Code charter (.claude/rules, .claude/settings.json hooks) and adapting it to
 * pi's tool calls. No pi imports, so `node --test` can load it from this repo.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, matchesGlob, relative, resolve } from "node:path";

export interface Rule {
	file: string;
	rel: string;
	/** undefined: the rule loads every session, as in Claude Code. */
	globs: string[] | undefined;
	body: string;
}

export interface HookCommand {
	command: string;
	timeoutSec: number;
}

export interface HookGroup {
	matcher: string;
	hooks: HookCommand[];
}

export type HookEvent = "PreToolUse" | "PostToolUse";

export interface Charter {
	root: string;
	rules: Rule[];
	hooks: Record<HookEvent, HookGroup[]>;
}

export interface ClaudeToolCall {
	tool_name: string;
	tool_input: Record<string, unknown>;
}

export interface HookRun {
	command: string;
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
}

export interface Verdict {
	block: boolean;
	ask: boolean;
	reason: string;
	/** Hook failures Claude Code shows the user but does not act on. */
	notices: string[];
}

// Claude Code's default hook timeout.
const DEFAULT_TIMEOUT_SEC = 60;

/**
 * True only when ~/.pi/agent/trust.json holds an explicit `true` for cwd or its
 * nearest ancestor with a decision. pi treats a folder with no .pi/ resources as
 * trusted without asking, so its own flag would run a cloned repo's hooks unasked.
 */
export function explicitlyTrusted(cwd: string, agentDir: string): boolean {
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(readFileSync(join(agentDir, "trust.json"), "utf8"));
	} catch {
		return false;
	}
	let dir = canonical(cwd);
	while (true) {
		const decision = data[dir];
		if (decision === true || decision === false) return decision;
		const parent = dirname(dir);
		if (parent === dir) return false;
		dir = parent;
	}
}

/**
 * The nearest directory at or above cwd that holds a .claude/ folder, without
 * leaving the git repository. ~/.claude is Claude Code's user config, not a
 * project charter, so the home directory never counts.
 */
export function findProjectRoot(cwd: string): string | undefined {
	const home = canonical(homedir());
	let dir = canonical(cwd);
	while (dir !== home) {
		if (existsSync(join(dir, ".claude"))) return dir;
		const parent = dirname(dir);
		if (existsSync(join(dir, ".git")) || parent === dir) return undefined;
		dir = parent;
	}
	return undefined;
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

/** The `paths:` globs from a rule's frontmatter: block list, flow list, or one string. */
export function rulePaths(markdown: string): string[] | undefined {
	const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
	if (!front) return undefined;
	const lines = front.split(/\r?\n/);
	const at = lines.findIndex((line) => /^paths\s*:/.test(line));
	if (at === -1) return undefined;
	const inline = lines[at].replace(/^paths\s*:/, "").trim();
	if (inline.startsWith("[")) return inline.slice(1, -1).split(",").map(unquote).filter(Boolean);
	if (inline) return [unquote(inline)];
	const globs: string[] = [];
	for (const line of lines.slice(at + 1)) {
		const item = /^\s*-\s*(.+)$/.exec(line);
		if (!item) break;
		globs.push(unquote(item[1]));
	}
	return globs;
}

function unquote(value: string): string {
	return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

export function stripFrontmatter(markdown: string): string {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

/** A rule with no globs, or a match-everything glob, loads every session. */
export function isAlwaysOn(rule: Rule): boolean {
	return !rule.globs || rule.globs.length === 0 || rule.globs.some((glob) => glob === "**" || glob === "**/*");
}

export function loadRules(root: string): Rule[] {
	const dir = join(root, ".claude", "rules");
	if (!existsSync(dir)) return [];
	return markdownFiles(dir).map((file) => {
		const text = readFileSync(file, "utf8");
		return { file, rel: relative(root, file), globs: rulePaths(text), body: stripFrontmatter(text) };
	});
}

function markdownFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...markdownFiles(full));
		else if (entry.name.endsWith(".md")) out.push(full);
	}
	return out.sort();
}

/** Path-scoped rules whose globs match a file inside the project. */
export function matchingRules(rules: Rule[], file: string, root: string): Rule[] {
	const rel = relative(root, file);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return [];
	return rules.filter((rule) => !isAlwaysOn(rule) && rule.globs!.some((glob) => matchesGlob(rel, glob)));
}

/**
 * PreToolUse and PostToolUse hooks from .claude/settings.json and
 * settings.local.json, which Claude Code merges the same way. A settings file
 * that does not parse throws. A guard that silently vanishes is worse than none.
 */
export function loadHooks(root: string): Record<HookEvent, HookGroup[]> {
	const hooks: Record<HookEvent, HookGroup[]> = { PreToolUse: [], PostToolUse: [] };
	for (const name of ["settings.json", "settings.local.json"]) {
		const path = join(root, ".claude", name);
		if (!existsSync(path)) continue;
		let settings: { hooks?: Record<string, unknown> };
		try {
			settings = JSON.parse(readFileSync(path, "utf8"));
		} catch (error) {
			throw new Error(`${path} is not valid JSON (${(error as Error).message}). Its hooks are not running. Fix the file, then run /reload.`);
		}
		for (const event of ["PreToolUse", "PostToolUse"] as const) {
			const groups = settings.hooks?.[event];
			if (!Array.isArray(groups)) continue;
			for (const group of groups) {
				const commands = (group?.hooks ?? [])
					.filter((hook: { type?: string; command?: unknown }) => hook?.type === "command" && typeof hook.command === "string")
					.map((hook: { command: string; timeout?: number }) => ({
						command: hook.command,
						timeoutSec: typeof hook.timeout === "number" ? hook.timeout : DEFAULT_TIMEOUT_SEC,
					}));
				if (commands.length) hooks[event].push({ matcher: String(group.matcher ?? ""), hooks: commands });
			}
		}
	}
	return hooks;
}

/**
 * Every hook event the project settings declare a command for. pi-claude-bridge
 * starts Claude Code with project settings, so these run with no pi trust check.
 * An unreadable file counts as a finding, because nobody can say what it runs.
 */
export function hookEvents(root: string): string[] {
	const events = new Set<string>();
	for (const name of ["settings.json", "settings.local.json"]) {
		const path = join(root, ".claude", name);
		if (!existsSync(path)) continue;
		let settings: { hooks?: Record<string, unknown> };
		try {
			settings = JSON.parse(readFileSync(path, "utf8"));
		} catch {
			events.add(`unreadable ${name}`);
			continue;
		}
		for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
			if (!Array.isArray(groups)) continue;
			const hasCommand = groups.some((group) => (group?.hooks ?? []).some((hook: { type?: string }) => hook?.type === "command"));
			if (hasCommand) events.add(event);
		}
	}
	return [...events].sort();
}

export interface Renamed {
	kind: "skill" | "command";
	from: string;
	to: string;
	source: string;
}

export interface ProjectResources {
	skillPaths: string[];
	promptPaths: string[];
	renamed: Renamed[];
}

/** Where renamed copies live. Outside the repo, so they never show up in its git status. */
export const GENERATED_BASE = join(tmpdir(), "pi-claude-charter");

export function generatedDir(root: string): string {
	return join(GENERATED_BASE, createHash("sha256").update(root).digest("hex").slice(0, 12));
}

/** The repo directory name as a skill-name prefix: lowercase letters, digits and hyphens. */
export function repoPrefix(root: string): string {
	return basename(root).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "repo";
}

export function skillName(markdown: string, fallback: string): string {
	const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1] ?? "";
	const name = /^name\s*:\s*(.+)$/m.exec(front)?.[1];
	return name ? unquote(name) : fallback;
}

/** The skill text with its frontmatter `name` set, added when missing. */
export function withSkillName(markdown: string, name: string): string {
	const match = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(markdown);
	if (!match) return `---\nname: ${name}\n---\n${markdown}`;
	const front = /^name\s*:/m.test(match[2]) ? match[2].replace(/^name\s*:.*$/m, `name: ${name}`) : `name: ${name}\n${match[2]}`;
	return match[1] + front + match[3] + markdown.slice(match[0].length);
}

/**
 * Paths for the repo's .claude/skills and .claude/commands. pi keeps the first
 * skill or prompt of each name, and it loads extension paths last. So pi would
 * skip a repo name that it already has. Each colliding one gets a renamed copy
 * as `<repo>-<name>`. A copied skill links its other files back to the repo.
 */
export function projectResources(root: string, taken: { skills: Set<string>; prompts: Set<string> }, outDir: string): ProjectResources {
	const result: ProjectResources = { skillPaths: [], promptPaths: [], renamed: [] };
	const prefix = repoPrefix(root);

	const skillsDir = join(root, ".claude", "skills");
	if (existsSync(skillsDir)) {
		for (const entry of readdirSync(skillsDir).sort()) {
			const dir = join(skillsDir, entry);
			const file = join(dir, "SKILL.md");
			if (!statSync(dir).isDirectory() || !existsSync(file)) continue;
			const text = readFileSync(file, "utf8");
			const name = skillName(text, entry);
			if (!taken.skills.has(name)) {
				result.skillPaths.push(dir);
				continue;
			}
			const to = `${prefix}-${name}`;
			const copy = join(outDir, "skills", to);
			mkdirSync(copy, { recursive: true });
			writeFileSync(join(copy, "SKILL.md"), withSkillName(text, to));
			for (const sibling of readdirSync(dir)) {
				const link = join(copy, sibling);
				if (sibling !== "SKILL.md" && !lstatSync(link, { throwIfNoEntry: false })) symlinkSync(join(dir, sibling), link);
			}
			result.skillPaths.push(copy);
			result.renamed.push({ kind: "skill", from: name, to, source: relative(root, file) });
		}
	}

	const commandsDir = join(root, ".claude", "commands");
	if (existsSync(commandsDir)) {
		for (const entry of readdirSync(commandsDir).sort()) {
			const file = join(commandsDir, entry);
			if (!entry.endsWith(".md") || !statSync(file).isFile()) continue;
			const name = entry.slice(0, -".md".length);
			if (!taken.prompts.has(name)) {
				result.promptPaths.push(file);
				continue;
			}
			const to = `${prefix}-${name}`;
			const copy = join(outDir, "commands", `${to}.md`);
			mkdirSync(dirname(copy), { recursive: true });
			writeFileSync(copy, readFileSync(file, "utf8"));
			result.promptPaths.push(copy);
			result.renamed.push({ kind: "command", from: name, to, source: relative(root, file) });
		}
	}
	return result;
}

/** Tells the model which name to use when the repo's own files name a renamed skill or command. */
export function renameNote(renamed: Renamed[]): string {
	const lines = renamed.map((entry) =>
		entry.kind === "skill"
			? `- \`/${entry.from}\` or skill \`${entry.from}\` means \`/skill:${entry.to}\` (${entry.source}).`
			: `- \`/${entry.from}\` means the prompt \`/${entry.to}\`. To run it yourself, read ${entry.source} and follow it.`,
	);
	return [
		"pi already had a skill or command with each name below, so claude-charter renamed this repository's version.",
		"When a file in this repository's .claude/ names one, it means the repository's version:",
		...lines,
		"The user-level skill or command with the original name is a different one.",
	].join("\n");
}

export function loadCharter(root: string): Charter {
	return { root, rules: loadRules(root), hooks: loadHooks(root) };
}

/** Claude Code matchers: empty or "*" match every tool, anything else is an anchored regex. */
export function matcherMatches(matcher: string, toolName: string): boolean {
	if (matcher === "" || matcher === "*") return true;
	try {
		return new RegExp(`^(?:${matcher})$`).test(toolName);
	} catch {
		return matcher === toolName;
	}
}

/**
 * The Claude Code name and input for a pi built-in tool call, so a hook script
 * written for Claude Code reads the fields it expects. Other tools have no
 * Claude Code counterpart and get no hooks.
 */
export function claudeToolCall(toolName: string, input: Record<string, unknown>, cwd: string): ClaudeToolCall | undefined {
	const file = typeof input.path === "string" ? resolve(cwd, input.path) : undefined;
	switch (toolName) {
		case "bash":
			return { tool_name: "Bash", tool_input: { command: input.command, timeout: input.timeout } };
		case "read":
			return { tool_name: "Read", tool_input: { file_path: file, offset: input.offset, limit: input.limit } };
		case "write":
			return { tool_name: "Write", tool_input: { file_path: file, content: input.content } };
		case "edit": {
			const edits = Array.isArray(input.edits) ? (input.edits as Array<{ oldText: string; newText: string }>) : [];
			if (edits.length === 1) {
				return { tool_name: "Edit", tool_input: { file_path: file, old_string: edits[0].oldText, new_string: edits[0].newText } };
			}
			const pairs = edits.map((edit) => ({ old_string: edit.oldText, new_string: edit.newText }));
			return { tool_name: "MultiEdit", tool_input: { file_path: file, edits: pairs } };
		}
		case "grep":
			return { tool_name: "Grep", tool_input: { ...input } };
		case "find":
			return { tool_name: "Glob", tool_input: { ...input } };
		case "ls":
			return { tool_name: "LS", tool_input: { ...input } };
		default:
			return undefined;
	}
}

/** Runs one hook command the way Claude Code does: bash in the project root, payload on stdin. */
export function runHook(hook: HookCommand, payload: object, root: string): Promise<HookRun> {
	return new Promise((done) => {
		const child = spawn("bash", ["-c", hook.command], {
			cwd: root,
			env: { ...process.env, CLAUDE_PROJECT_DIR: root },
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGKILL");
		}, hook.timeoutSec * 1000);
		child.stdout.on("data", (chunk) => (stdout += chunk));
		child.stderr.on("data", (chunk) => (stderr += chunk));
		child.on("error", (error) => {
			clearTimeout(timer);
			done({ command: hook.command, code: null, stdout, stderr: stderr || error.message, timedOut });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			done({ command: hook.command, code, stdout, stderr, timedOut });
		});
		// A hook can exit without reading stdin. The closed pipe is not an error.
		child.stdin.on("error", () => {});
		child.stdin.end(JSON.stringify(payload));
	});
}

export function hooksFor(charter: Charter, event: HookEvent, toolName: string): HookCommand[] {
	return charter.hooks[event].filter((group) => matcherMatches(group.matcher, toolName)).flatMap((group) => group.hooks);
}

/**
 * Claude Code's exit-code contract. The repo wrote its hooks for it, so the
 * adapter keeps it as is. Exit 2 blocks with stderr as the reason. Exit 0
 * passes and may carry a JSON decision. Any other exit is a non-blocking error.
 */
export function verdict(runs: HookRun[]): Verdict {
	const result: Verdict = { block: false, ask: false, reason: "", notices: [] };
	const reasons: string[] = [];
	for (const run of runs) {
		if (run.timedOut) {
			result.notices.push(`hook timed out: ${run.command}`);
		} else if (run.code === 2) {
			result.block = true;
			reasons.push(run.stderr.trim() || `hook exited 2: ${run.command}`);
		} else if (run.code === 0) {
			const decision = jsonDecision(run.stdout);
			if (decision?.kind === "deny") {
				result.block = true;
				reasons.push(decision.reason || `denied by hook: ${run.command}`);
			} else if (decision?.kind === "ask") {
				result.ask = true;
				reasons.push(decision.reason || `hook asks for approval: ${run.command}`);
			}
		} else {
			result.notices.push(`hook exited ${run.code}: ${run.command}${run.stderr.trim() ? `\n${run.stderr.trim()}` : ""}`);
		}
	}
	result.reason = reasons.join("\n\n");
	return result;
}

function jsonDecision(stdout: string): { kind: "deny" | "ask"; reason: string } | undefined {
	const text = stdout.trim();
	if (!text.startsWith("{")) return undefined;
	let output: {
		decision?: string;
		reason?: string;
		hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
	};
	try {
		output = JSON.parse(text);
	} catch {
		return undefined;
	}
	const specific = output.hookSpecificOutput;
	if (specific?.permissionDecision === "deny") return { kind: "deny", reason: specific.permissionDecisionReason ?? "" };
	if (specific?.permissionDecision === "ask") return { kind: "ask", reason: specific.permissionDecisionReason ?? "" };
	if (output.decision === "block") return { kind: "deny", reason: output.reason ?? "" };
	return undefined;
}
