/**
 * Protected Paths — polyglot web engineer edition.
 *
 * Blocks write/edit tool calls to sensitive or generated paths across
 * PHP, Python, Go, Ruby, and TypeScript projects.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROTECTED: Array<string | RegExp> = [
	// secrets / env
	".env",
	".env.local",
	".env.production",
	/(^|\/)\.envrc$/,
	/(^|\/)\.netrc$/,
	/(^|\/)\.npmrc$/,
	/(^|\/)\.pypirc$/,

	// vcs / ci internals
	".git/",
	".github/workflows/", // uncomment-worthy: remove if you *want* the agent editing CI

	// language ecosystems — dependency dirs and lockfile-adjacent junk
	"node_modules/",
	"vendor/", // php (composer) + go
	"vendor/bundle/", // ruby (bundler --path)
	".venv/",
	"venv/",
	"__pycache__/",
	".tox/",
	".pytest_cache/",
	".mypy_cache/",
	".ruff_cache/",
	"dist/",
	"build/",
	".next/",
	".turbo/",
	".parcel-cache/",

	// go
	/(^|\/)go\.sum$/,

	// ruby
	/(^|\/)Gemfile\.lock$/,

	// php
	/(^|\/)composer\.lock$/,

	// js/ts lockfiles (agents love to "fix" these)
	/(^|\/)package-lock\.json$/,
	/(^|\/)pnpm-lock\.yaml$/,
	/(^|\/)yarn\.lock$/,
	/(^|\/)bun\.lockb?$/,

	// python lockfiles
	/(^|\/)poetry\.lock$/,
	/(^|\/)uv\.lock$/,
	/(^|\/)Pipfile\.lock$/,
];

function isProtected(path: string): string | null {
	for (const rule of PROTECTED) {
		if (typeof rule === "string") {
			if (path.includes(rule)) return rule;
		} else if (rule.test(path)) {
			return rule.source;
		}
	}
	return null;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;

		const path = event.input.path as string | undefined;
		if (!path) return;

		const hit = isProtected(path);
		if (!hit) return;

		if (ctx.hasUI) {
			ctx.ui.notify(`Blocked write to protected path: ${path}`, "warning");
		}
		return {
			block: true,
			reason: `Path "${path}" is protected (matched rule: ${hit})`,
		};
	});
}
