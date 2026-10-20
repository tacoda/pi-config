// Shared by install.ts, check.ts, verify.ts and scan-secrets.ts.
//
// Node runs these .ts files directly by stripping the types, so there is no
// build step and no dependency. The cost: only erasable syntax works. No enums,
// namespaces or constructor parameter properties, and relative imports keep
// their .ts extension. Types are not checked; Node only removes them.
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

export const REPO = import.meta.dirname;
export const AGENT_SRC = join(REPO, "agent");
export const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
export const SKILLS_DIR = join(homedir(), ".agents", "skills");
export const MIN_NODE = [24, 13] as const;

export interface Problem {
	problem: string;
	fix: string;
}

/** Prints each problem with its fix and returns the exit status. */
export function report(problems: Problem[]): number {
	for (const { problem, fix } of problems) {
		console.log(`FAIL: ${problem}`);
		console.log(`      fix: ${fix}`);
	}
	return problems.length ? 1 : 0;
}

export function nodeIsSupported(): boolean {
	const [major, minor] = process.versions.node.split(".").map(Number);
	return major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
}

export function commandExists(cmd: string): boolean {
	return spawnSync("sh", ["-c", 'command -v "$1"', "sh", cmd], { stdio: "ignore" }).status === 0;
}

/** Stdout of a command, or "" if it fails. */
export function capture(cmd: string, args: string[], options: SpawnSyncOptions = {}): string {
	const result = spawnSync(cmd, args, { encoding: "utf8", ...options });
	return result.status === 0 ? String(result.stdout) : "";
}

/** Runs a command with its output on this terminal. Throws if it fails. */
export function run(cmd: string, args: string[]): void {
	const result = spawnSync(cmd, args, { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`'${[cmd, ...args].join(" ")}' exited with status ${result.status}`);
}

/** True for a file, a directory, or a symlink, including a dangling one. */
export function pathExists(path: string): boolean {
	return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

function walk(dir: string, skip: Set<string>, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (skip.has(entry.name)) continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, skip, out);
		else if (entry.isFile()) out.push(full);
	}
	return out;
}

/** Paths under agent/, relative to it. install.ts links each into AGENT_DIR. */
export function trackedFiles(): string[] {
	return walk(AGENT_SRC, new Set([".DS_Store"]))
		.map((full) => relative(AGENT_SRC, full))
		.sort();
}

export function isLinked(rel: string): boolean {
	const dst = join(AGENT_DIR, rel);
	return lstatSync(dst, { throwIfNoEntry: false })?.isSymbolicLink() === true && readlinkSync(dst) === join(AGENT_SRC, rel);
}

/**
 * Links in AGENT_DIR that point into agent/ at a file that no longer exists.
 * A file renamed or deleted here leaves one behind.
 */
export function staleLinks(): string[] {
	const dirs = new Set([".", "extensions", "prompts", "themes", ...trackedFiles().map(dirname)]);
	const stale: string[] = [];
	for (const dir of dirs) {
		const full = join(AGENT_DIR, dir);
		if (!existsSync(full)) continue;
		for (const entry of readdirSync(full, { withFileTypes: true })) {
			const link = join(full, entry.name);
			if (entry.isSymbolicLink() && readlinkSync(link).startsWith(`${AGENT_SRC}/`) && !existsSync(link)) stale.push(link);
		}
	}
	return stale;
}

/** Package sources declared in agent/settings.json. */
export function packageSources(): string[] {
	const settings = JSON.parse(readFileSync(join(AGENT_SRC, "settings.json"), "utf8"));
	return (settings.packages ?? []).map((p: string | { source: string }) => (typeof p === "string" ? p : p.source));
}

export function missingPackages(): string[] {
	// `pi list` prints each source indented two spaces, then its install path on the next line.
	const lines = capture("pi", ["list"]).split("\n");
	const installed = new Map<string, string>();
	lines.forEach((line, i) => {
		if (/^ {2}\S/.test(line)) installed.set(line.trim(), (lines[i + 1] ?? "").trim());
	});
	return packageSources().filter((source) => {
		const path = installed.get(source);
		return !path || !existsSync(path);
	});
}

/** preset.ts loads this module to cap subagent tools. Returns an error message, or "" if it resolves. */
export function capabilityCeilingError(): string {
	try {
		createRequire(join(AGENT_DIR, "npm", "package.json")).resolve("pi-subagents/capability-ceiling");
		return "";
	} catch (error) {
		return (error as Error).message.split("\n")[0];
	}
}

/** skills.txt: one source per line, `<owner/repo> <skill> [<skill> ...]`. */
export function missingSkills(): Array<{ source: string; missing: string[] }> {
	return readFileSync(join(REPO, "skills.txt"), "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"))
		.map((line) => {
			const [source, ...names] = line.split(/\s+/);
			return { source, missing: names.filter((name) => !existsSync(join(SKILLS_DIR, name, "SKILL.md"))) };
		})
		.filter(({ missing }) => missing.length > 0);
}

// Each prefix is kept apart from its separator so this file does not match its own pattern.
const PREFIXES: Array<[string, string]> = [
	["ctx7sk", "-"],
	["sk-ant", "-"],
	["sk-proj", "-"],
	["ghp", "_"],
	["gho", "_"],
	["github_pat", "_"],
];
const SECRET = new RegExp(
	[
		...PREFIXES.map(([prefix, sep]) => prefix + sep),
		"sk-[A-Za-z0-9]{32,}",
		"xox[abp]-",
		"AKIA[0-9A-Z]{16}",
		"-----BEGIN [A-Z ]*PRIVATE KEY",
		'"(access|refresh)_token"',
	].join("|"),
);

/** Credentials live in pi auth and the environment, never in this public repository. */
export function scanSecrets(): Problem[] {
	const problems: Problem[] = [];
	// pi writes these into its agent directory; none of them belongs in git.
	for (const name of ["auth.json", "models-store.json", "trust.json"]) {
		const tracked = capture("git", ["-C", REPO, "ls-files", "--", `agent/${name}`]).trim();
		if (tracked || pathExists(join(AGENT_SRC, name))) {
			problems.push({ problem: `agent/${name} is in the repository`, fix: `git rm --cached agent/${name}, then move it back to ${AGENT_DIR}` });
		}
	}
	for (const file of walk(REPO, new Set([".git", "node_modules"]))) {
		const bytes = readFileSync(file);
		if (bytes.includes(0)) continue; // binary
		if (SECRET.test(bytes.toString("utf8"))) {
			problems.push({
				problem: `${relative(REPO, file)} looks like it holds a credential`,
				fix: "move the value to pi auth (/login) or an env var, and reference it as ${NAME}",
			});
		}
	}
	return problems;
}
