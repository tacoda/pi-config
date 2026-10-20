/**
 * Claude Charter — projects a repository's Claude Code charter into pi.
 *
 * Under pi, a repo's .claude/ directory mostly never reaches the model.
 * pi-claude-bridge excludes .claude/rules from its Claude Code child. pi does
 * not read .claude/skills or .claude/commands. The bridge names pi's tools
 * mcp__custom-tools__edit, so PreToolUse matchers like "Edit|Write" never fire.
 * A guard that holds in Claude Code and not in pi is a guard with a hole in it.
 *
 * In a project trusted with /trust, this extension:
 * - adds always-on .claude/rules to the context files, like CLAUDE.md.
 * - appends a path-scoped rule to the first read, edit or write of a matching
 *   file. It does so once per session, and again after a compaction drops it.
 * - offers .claude/skills and .claude/commands as skills and prompt templates.
 * - runs .claude/settings.json PreToolUse and PostToolUse hooks on pi's
 *   built-in tools, with Claude Code's payload and exit-code contract.
 *
 * This extension does not run SessionStart, Stop or UserPromptSubmit hooks. The bridge's
 * Claude Code child already fires them, and a second run doubles slow checks.
 *
 * That child loads project settings with no trust check, so an untrusted repo's
 * hooks run as shell commands at the first prompt. A repo can declare hooks and
 * have no explicit /trust entry. There, this extension holds each prompt for the
 * bridge until the person chooses to send it.
 */

import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	type Charter,
	type HookEvent,
	claudeToolCall,
	explicitlyTrusted,
	findProjectRoot,
	GENERATED_BASE,
	generatedDir,
	hookEvents,
	hooksFor,
	isAlwaysOn,
	loadHooks,
	loadRules,
	matchingRules,
	projectResources,
	type Renamed,
	renameNote,
	runHook,
	verdict,
} from "./charter.ts";

const FILE_TOOLS = new Set(["read", "edit", "write"]);

// AskClaude, the bridge's other route into Claude Code, is off by default.
const BRIDGE_PROVIDER = "claude-bridge";

function isTrusted(cwd: string, ctx: ExtensionContext): boolean {
	return ctx.isProjectTrusted() && explicitlyTrusted(cwd, getAgentDir());
}

function trustedRoot(cwd: string, ctx: ExtensionContext): string | undefined {
	return isTrusted(cwd, ctx) ? findProjectRoot(cwd) : undefined;
}

export default function (pi: ExtensionAPI) {
	let charter: Charter | undefined;
	const injected = new Set<string>();
	// Set when an untrusted repo declares hooks the bridge would run.
	let exposure: string | undefined;
	let renamed: Renamed[] = [];

	pi.on("session_start", async (_event, ctx) => {
		charter = undefined;
		exposure = undefined;
		renamed = [];
		injected.clear();
		const found = findProjectRoot(ctx.cwd);
		if (found && !isTrusted(ctx.cwd, ctx)) {
			const events = hookEvents(found);
			if (events.length) {
				exposure =
					`${found}/.claude declares hooks (${events.join(", ")}). ` +
					`${BRIDGE_PROVIDER} makes Claude Code run them as shell commands with your permissions. ` +
					"pi has no explicit trust entry for this folder.";
			}
		}
		const root = trustedRoot(ctx.cwd, ctx);
		if (!root) return;
		charter = { root, rules: loadRules(root), hooks: { PreToolUse: [], PostToolUse: [] } };
		try {
			charter.hooks = loadHooks(root);
		} catch (error) {
			const message = `claude-charter: ${(error as Error).message}`;
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else console.error(message);
		}
	});

	pi.on("input", async (_event, ctx) => {
		if (!exposure || ctx.model?.provider !== BRIDGE_PROVIDER) return { action: "continue" };
		const fix = "Read .claude/settings.json and .claude/settings.local.json. If you accept the hooks, run /trust, then /reload.";
		if (ctx.hasUI) {
			const send = "Send anyway, for this session only";
			const choice = await ctx.ui.select(exposure, ["Do not send, I will review the hooks first", send]);
			if (choice === send) {
				exposure = undefined;
				return { action: "continue" };
			}
			ctx.ui.notify(`claude-charter: prompt not sent. ${fix}`, "warning");
		} else {
			console.error(`claude-charter: prompt not sent. ${exposure} ${fix}`);
		}
		return { action: "handled" };
	});

	// A compaction or tree move can drop the turn that carried a rule, so offer it again.
	pi.on("session_compact", async () => injected.clear());
	pi.on("session_tree", async () => injected.clear());

	pi.on("resources_discover", async (event, ctx) => {
		const root = trustedRoot(event.cwd, ctx);
		if (!root) return;
		// At this event pi holds the user and project resources. It adds every extension's paths after it.
		const own = join(root, ".claude");
		const taken = { skills: new Set<string>(), prompts: new Set<string>() };
		for (const command of pi.getCommands()) {
			const path = command.sourceInfo?.path ?? "";
			if (path.startsWith(own) || path.startsWith(GENERATED_BASE)) continue;
			if (command.source === "skill") taken.skills.add(command.name.replace(/^skill:/, ""));
			else taken.prompts.add(command.name);
		}
		try {
			const resources = projectResources(root, taken, generatedDir(root));
			renamed = resources.renamed;
			if (renamed.length && ctx.hasUI) {
				const names = renamed.map((entry) => `${entry.from} -> ${entry.kind === "skill" ? "skill:" : ""}${entry.to}`).join(", ");
				ctx.ui.notify(`claude-charter renamed repo ${renamed.length === 1 ? "entry" : "entries"} that pi already had: ${names}`, "info");
			}
			return { skillPaths: resources.skillPaths, promptPaths: resources.promptPaths };
		} catch (error) {
			const message = `claude-charter: could not prepare .claude/skills and .claude/commands (${(error as Error).message}). Fix the cause, then run /reload.`;
			if (ctx.hasUI) ctx.ui.notify(message, "error");
			else console.error(message);
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (!charter) return;
		const files = event.systemPromptOptions.contextFiles;
		for (const rule of charter.rules) {
			if (isAlwaysOn(rule) && !files.some((file) => file.path === rule.file)) {
				files.push({ path: rule.file, content: rule.body });
			}
		}
		const notePath = join(charter.root, ".claude", "(renamed by claude-charter)");
		if (renamed.length && !files.some((file) => file.path === notePath)) {
			files.push({ path: notePath, content: renameNote(renamed) });
		}
	});

	const runHooks = async (
		event: HookEvent,
		toolName: string,
		input: Record<string, unknown>,
		ctx: ExtensionContext,
		extra: Record<string, unknown> = {},
	) => {
		if (!charter) return undefined;
		const call = claudeToolCall(toolName, input, ctx.cwd);
		if (!call) return undefined;
		const hooks = hooksFor(charter, event, call.tool_name);
		if (!hooks.length) return undefined;
		const payload = { session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, hook_event_name: event, ...call, ...extra };
		const root = charter.root;
		const result = verdict(await Promise.all(hooks.map((hook) => runHook(hook, payload, root))));
		if (ctx.hasUI) for (const notice of result.notices) ctx.ui.notify(`claude-charter ${event}: ${notice}`, "warning");
		return result;
	};

	pi.on("tool_call", async (event, ctx) => {
		const result = await runHooks("PreToolUse", event.toolName, event.input as Record<string, unknown>, ctx);
		if (!result) return;
		if (result.block) return { block: true, reason: result.reason };
		if (result.ask && !(ctx.hasUI && (await ctx.ui.confirm("A project hook asks for approval", result.reason)))) {
			return { block: true, reason: result.reason };
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!charter) return;
		const appended: string[] = [];

		// A nested call (a codemode script) returns to the script, so the model never sees a rule appended there.
		const path = event.input.path;
		if (FILE_TOOLS.has(event.toolName) && !event.isError && !event.parentToolCallId && typeof path === "string") {
			for (const rule of matchingRules(charter.rules, resolve(ctx.cwd, path), charter.root)) {
				if (injected.has(rule.file)) continue;
				injected.add(rule.file);
				appended.push(`<project-rule source="${rule.rel}" applies-to="${rule.globs!.join(", ")}">\n${rule.body}\n</project-rule>`);
			}
		}

		const output = event.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
		const result = await runHooks("PostToolUse", event.toolName, event.input as Record<string, unknown>, ctx, {
			tool_response: { success: !event.isError, output },
		});
		if (result?.block) appended.push(`PostToolUse hook feedback:\n${result.reason}`);

		if (!appended.length) return;
		return { content: [...event.content, { type: "text" as const, text: appended.join("\n\n") }] };
	});
}
