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
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	type Charter,
	type HookEvent,
	claudeToolCall,
	explicitlyTrusted,
	findProjectRoot,
	hooksFor,
	isAlwaysOn,
	loadHooks,
	loadRules,
	matchingRules,
	runHook,
	verdict,
} from "./charter.ts";

const FILE_TOOLS = new Set(["read", "edit", "write"]);

function trustedRoot(cwd: string, ctx: ExtensionContext): string | undefined {
	if (!ctx.isProjectTrusted() || !explicitlyTrusted(cwd, getAgentDir())) return undefined;
	return findProjectRoot(cwd);
}

export default function (pi: ExtensionAPI) {
	let charter: Charter | undefined;
	const injected = new Set<string>();

	pi.on("session_start", async (_event, ctx) => {
		charter = undefined;
		injected.clear();
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

	// A compaction or tree move can drop the turn that carried a rule, so offer it again.
	pi.on("session_compact", async () => injected.clear());
	pi.on("session_tree", async () => injected.clear());

	pi.on("resources_discover", async (event, ctx) => {
		const root = trustedRoot(event.cwd, ctx);
		if (!root) return;
		const dir = (name: string) => join(root, ".claude", name);
		return {
			skillPaths: existsSync(dir("skills")) ? [dir("skills")] : [],
			promptPaths: existsSync(dir("commands")) ? [dir("commands")] : [],
		};
	});

	pi.on("before_agent_start", async (event) => {
		if (!charter) return;
		const files = event.systemPromptOptions.contextFiles;
		for (const rule of charter.rules) {
			if (isAlwaysOn(rule) && !files.some((file) => file.path === rule.file)) {
				files.push({ path: rule.file, content: rule.body });
			}
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
