#!/usr/bin/env node
// Links agent/ into pi's agent directory and installs what the configuration
// depends on. Safe to re-run: each step skips what is already in place, and
// nothing is upgraded. Run ./check.ts afterwards.
import { existsSync, mkdirSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	AGENT_DIR,
	AGENT_SRC,
	MIN_NODE,
	REPO,
	SKILLS_DIR,
	commandExists,
	isLinked,
	missingPackages,
	missingSkills,
	nodeIsSupported,
	pathExists,
	run,
	staleLinks,
	trackedFiles,
} from "./lib.ts";

const skipped: string[] = [];

/** An optional tool that is missing skips its step and is reported at the end. */
function want(cmd: string, fix: string): boolean {
	if (commandExists(cmd)) return true;
	skipped.push(`${cmd} not found, so its step was skipped. ${fix}`);
	return false;
}

if (!nodeIsSupported()) {
	console.error(`error: Node.js ${MIN_NODE.join(".")} or later is required; this is ${process.version}. Run: mise use -g node@24`);
	process.exit(1);
}
const required: Array<[string, string]> = [
	["npx", "npx ships with Node.js; reinstall Node.js."],
	["git", "Install git (xcode-select --install, or brew install git)."],
	["pi", "Install pi: npm install -g @earendil-works/pi-coding-agent"],
	["claude", "pi-claude-bridge runs the Claude Code CLI. Install Claude Code, then run 'claude' once to log in."],
];
for (const [cmd, fix] of required) {
	if (!commandExists(cmd)) {
		console.error(`error: '${cmd}' is not on PATH. ${fix}`);
		process.exit(1);
	}
}

console.log(`==> Linking ${AGENT_SRC} into ${AGENT_DIR}`);
// UTC, compact: 20261020-155553
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const backupDir = join(homedir(), ".pi", "agent-removed", `pi-config-backup-${stamp}`);
let backedUp = false;
for (const rel of trackedFiles()) {
	if (isLinked(rel)) continue;
	const dst = join(AGENT_DIR, rel);
	if (pathExists(dst)) {
		mkdirSync(dirname(join(backupDir, rel)), { recursive: true });
		renameSync(dst, join(backupDir, rel));
		backedUp = true;
		console.log(`    backed up ${rel}`);
	}
	mkdirSync(dirname(dst), { recursive: true });
	symlinkSync(join(AGENT_SRC, rel), dst);
	console.log(`    linked ${rel}`);
}
for (const link of staleLinks()) {
	unlinkSync(link);
	console.log(`    removed stale link ${link}`);
}

console.log("==> pi packages (from settings.json)");
for (const source of missingPackages()) {
	console.log(`    installing ${source}`);
	run("pi", ["install", source]);
}

console.log("==> rtk extension");
if (want("rtk", "Install it with 'brew install rtk', then re-run.") && !existsSync(join(AGENT_DIR, "extensions", "rtk.ts"))) {
	run("rtk", ["init", "-g", "--agent", "pi"]);
}

console.log("==> graphify skill");
if (want("graphify", "Install it with 'uv tool install graphifyy', then re-run.") && !existsSync(join(AGENT_DIR, "skills", "graphify", "SKILL.md"))) {
	run("graphify", ["install", "--platform", "pi"]);
}

console.log("==> Shared skills (from skills.txt)");
for (const { source, missing } of missingSkills()) {
	console.log(`    ${source}: ${missing.join(" ")}`);
	run("npx", ["--yes", "skills", "add", source, "-g", "-a", "pi", "-s", ...missing, "-y"]);
}

console.log("==> chunk-sidecar skill");
if (want("chunk", "Install CircleCI's chunk CLI, then re-run.") && !existsSync(join(SKILLS_DIR, "chunk-sidecar", "SKILL.md"))) {
	run("chunk", ["skill", "install"]);
}

console.log("==> Pre-commit secret scan");
if (commandExists("git") && pathExists(join(REPO, ".git"))) {
	run("git", ["-C", REPO, "config", "core.hooksPath", ".githooks"]);
} else {
	skipped.push(`${REPO} is not a git repository, so the pre-commit hook is off. Run 'git init', then re-run.`);
}

if (backedUp) console.log(`Replaced files were moved to ${backupDir}`);
for (const line of skipped) console.error(`warning: ${line}`);
console.log("Done. Run ./check.ts to confirm, and ./verify.ts to test against the model.");
