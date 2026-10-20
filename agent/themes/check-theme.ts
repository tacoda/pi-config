#!/usr/bin/env node
// Checks a pi theme file the way pi will read it, then measures WCAG contrast
// of each foreground color against the surfaces pi actually draws it on.
//
//   ~/.pi/agent/themes/check-theme.ts ~/.pi/agent/themes/beluga.json [minimum]
//
// Exits non-zero if the file breaks pi's schema or any pair falls below the
// minimum (default 4.5, the WCAG AA floor for body text). Pass a theme name
// such as `dark` instead of a path to measure a built-in for comparison.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

type Rgb = { r: number; g: number; b: number };

const piBin = fs.realpathSync(execFileSync("which", ["pi"], { encoding: "utf8" }).trim());
const piRoot = piBin.slice(0, piBin.lastIndexOf("/dist/"));
const themeModule = path.join(piRoot, "dist/modes/interactive/theme/theme.js");
const builtinDir = path.join(piRoot, "dist/modes/interactive/theme");
const schema = JSON.parse(fs.readFileSync(path.join(piRoot, "schemas/theme.schema.json"), "utf8"));
const { loadThemeFromPath } = await import(themeModule);

const [arg, minArg] = process.argv.slice(2);
if (!arg) {
	console.error("usage: check-theme.ts <theme.json | builtin-name> [minimum-contrast]");
	process.exit(2);
}
const themePath = fs.existsSync(arg) ? arg : path.join(builtinDir, `${arg}.json`);
const minimum = Number(minArg ?? 4.5);
const problems: string[] = [];

// pi rejects unknown keys, so a typo in a token name fails at startup, not here, unless we look.
const json = JSON.parse(fs.readFileSync(themePath, "utf8"));
const topKeys = Object.keys(schema.properties);
for (const key of Object.keys(json)) if (!topKeys.includes(key)) problems.push(`unknown top-level key "${key}"`);
const colorSchema = schema.properties.colors;
for (const key of Object.keys(json.colors)) if (!(key in colorSchema.properties)) problems.push(`unknown color "${key}"`);
for (const key of colorSchema.required ?? []) if (!(key in json.colors)) problems.push(`missing required color "${key}"`);

// pi's theme module is loaded at runtime from its install, so it has no types here.
let theme: any;
try {
	theme = loadThemeFromPath(themePath, "truecolor");
} catch (error) {
	problems.push(`pi could not load it: ${(error as Error).message}`);
}

if (theme) {
	const colors: Record<string, Rgb> = theme.colors;
	// A dark terminal's own background is unknown, so test the two ends people use.
	const terminals: Record<string, Rgb> = { black: { r: 0, g: 0, b: 0 }, charcoal: { r: 0x28, g: 0x2a, b: 0x36 } };
	const panels = ["toolPendingBg", "toolSuccessBg", "toolErrorBg"];
	const messages = ["userMessageBg", "customMessageBg"];
	// Mirrors the surface pairs in pi's system-theme RULES table.
	const pairs: Array<[string, string[]]> = [
		["text", ["bg", "selectedBg"]],
		["userMessageText", ["userMessageBg"]],
		["toolTitle", panels],
		...["accent", "success", "error", "warning"].map((t): [string, string[]] => [t, ["bg", "selectedBg", ...panels]]),
		["muted", ["bg", "selectedBg", "customMessageBg", ...panels]],
		["thinkingText", ["bg"]],
		["customMessageText", ["customMessageBg", ...panels]],
		["customMessageLabel", ["bg", "customMessageBg", "selectedBg", ...panels]],
		["toolOutput", ["bg", ...panels]],
		...["mdHeading", "mdLink", "mdCode", "mdQuote", "mdListBullet"].map((t): [string, string[]] => [t, ["bg", ...messages]]),
		["mdCodeBlock", ["bg", ...messages, ...panels]],
		...["toolDiffAdded", "toolDiffRemoved", "toolDiffContext"].map((t): [string, string[]] => [t, ["bg", ...panels]]),
		...["syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType"].map(
			(t): [string, string[]] => [t, ["bg", ...messages, ...panels]],
		),
		["searchMatchText", ["searchMatchBg"]],
	];

	const luminance = ({ r, g, b }: Rgb) => {
		const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	};
	const contrast = (a: Rgb, b: Rgb) => {
		const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
		return (x + 0.05) / (y + 0.05);
	};

	console.log(`${json.name}: lowest contrast per color (minimum ${minimum})`);
	for (const [token, surfaces] of pairs) {
		let worst = { ratio: Infinity, on: "" };
		for (const surface of surfaces) {
			const backs: Array<[string, Rgb]> = surface === "bg" ? Object.entries(terminals) : [[surface, colors[surface]]];
			for (const [name, back] of backs) {
				const ratio = contrast(colors[token], back);
				if (ratio < worst.ratio) worst = { ratio, on: name };
			}
		}
		const flag = worst.ratio < minimum ? "  << too low" : "";
		console.log(`  ${token.padEnd(20)} ${worst.ratio.toFixed(2).padStart(6)}  on ${worst.on}${flag}`);
		if (flag) problems.push(`${token} is ${worst.ratio.toFixed(2)}:1 on ${worst.on}; raise its lightness in vars`);
	}
}

if (problems.length) {
	console.error(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
	process.exit(1);
}
console.log("\nok");
