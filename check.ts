#!/usr/bin/env node
// Checks that this machine matches the repository. Makes no changes, calls no
// model, and needs no network. Exits 1 if any check fails; each failure names
// the fix.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	AGENT_DIR,
	AGENT_SRC,
	MIN_NODE,
	REPO,
	SKILLS_DIR,
	type Problem,
	capabilityCeilingError,
	capture,
	commandExists,
	isLinked,
	missingPackages,
	missingSkills,
	nodeIsSupported,
	report,
	scanSecrets,
	staleLinks,
	trackedFiles,
} from "./lib.ts";

const problems: Problem[] = [];
const fail = (problem: string, fix: string) => problems.push({ problem, fix });

if (!nodeIsSupported()) fail(`Node.js is ${process.version}; ${MIN_NODE.join(".")} or later is required`, "mise use -g node@24");
for (const cmd of ["npx", "git", "pi", "claude", "rtk", "graphify"]) {
	if (!commandExists(cmd)) fail(`'${cmd}' is not on PATH`, "see the prerequisites in README.md");
}

for (const rel of trackedFiles()) {
	if (!isLinked(rel)) fail(`${join(AGENT_DIR, rel)} is not a link to ${join(AGENT_SRC, rel)}`, "./install.ts");
	if (!rel.endsWith(".json")) continue;
	try {
		JSON.parse(readFileSync(join(AGENT_SRC, rel), "utf8"));
	} catch (error) {
		fail(`agent/${rel} is not valid JSON: ${(error as Error).message}`, "fix the syntax error at the position in that message");
	}
}
for (const link of staleLinks()) fail(`${link} points at a file that is no longer in the repository`, "./install.ts");

for (const source of missingPackages()) fail(`pi package ${source} is not installed`, `./install.ts, or pi install ${source}`);

// Without this module, presets remove the subagent tool instead of capping it,
// so a broken resolve shows up as a missing tool rather than an error.
const ceilingError = capabilityCeilingError();
if (ceilingError) fail(`pi-subagents/capability-ceiling does not resolve from ${AGENT_DIR}/npm: ${ceilingError}`, "pi install npm:pi-subagents");

if (!existsSync(join(AGENT_DIR, "extensions", "rtk.ts"))) fail("the rtk extension is missing", "rtk init -g --agent pi");
if (!existsSync(join(AGENT_DIR, "skills", "graphify", "SKILL.md"))) fail("the graphify skill is missing", "graphify install --platform pi");
if (!existsSync(join(SKILLS_DIR, "chunk-sidecar", "SKILL.md"))) fail("the chunk-sidecar skill is missing", "chunk skill install");
for (const { source, missing } of missingSkills()) {
	for (const name of missing) fail(`skill ${name} (${source}) is missing`, "./install.ts");
}

problems.push(...scanSecrets());
if (capture("git", ["-C", REPO, "config", "core.hooksPath"]).trim() !== ".githooks") {
	fail("the pre-commit secret scan is not active", "./install.ts, or git config core.hooksPath .githooks");
}

const status = report(problems);
console.log(status ? `${problems.length} check(s) failed.` : "All checks passed.");
process.exit(status);
