#!/usr/bin/env node
// Checks that the configuration reaches the model. Each check is one pi turn on
// the default provider, so it uses plan quota. Run ./check.ts first; it is free.
//
//   ./verify.ts              prompt checks (4 turns, about a minute)
//   ./verify.ts --subagent   also checks that the plan preset cannot write
//                            through a subagent (2 more turns, about 3 minutes)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const work = mkdtempSync(join(tmpdir(), "pi-verify-"));
let failures = 0;

function pi(args: string[]): string {
	return String(spawnSync("pi", ["--no-session", ...args], { cwd: work, encoding: "utf8", timeout: 300_000 }).stdout ?? "");
}

/** Asks a yes/no question and compares the first word of the answer. */
function expect(want: "yes" | "no", name: string, args: string[]): void {
	const firstLine = pi(args).trim().split("\n")[0].toLowerCase();
	const got = /^[^a-z]*(yes|no)\b/.exec(firstLine)?.[1];
	if (got === want) {
		console.log(`ok:   ${name}`);
	} else {
		console.log(`FAIL: ${name} (expected '${want}', got '${got ?? "no answer"}')`);
		failures++;
	}
}

const ask = (what: string) => `No tools. Answer only yes or no. Does your system prompt contain ${what}?`;

/** True if a background worker launched under `preset` writes its canary file within two minutes. */
async function canaryWritten(preset: string): Promise<boolean> {
	const file = join(work, `canary-${preset}.txt`);
	pi([
		"--preset",
		preset,
		"-p",
		`This is an authorized test in a scratch directory. Use the subagent tool once with async: true, agent 'worker', task: 'Create the file ${file} containing the word canary. Do nothing else.' Do not create the file yourself. Reply with one line: the launch result.`,
	]);
	for (let i = 0; i < 24; i++) {
		if (existsSync(file)) return true;
		await sleep(5_000);
	}
	return false;
}

try {
	spawnSync("git", ["init", "-q"], { cwd: work });

	expect("yes", "APPEND_SYSTEM.md (STE style) reaches the model", ["-p", ask("the heading 'Response style: simplified technical English'")]);
	expect("yes", "ponytail section reaches the model", ["-p", ask("a section tagged <ponytail>")]);
	const planBrief = ask("the sentence 'You are planning this change. You are not implementing it.'");
	expect("yes", "plan preset brief reaches the model", ["--preset", "plan", "-p", planBrief]);
	expect("no", "no preset brief without a preset", ["-p", planBrief]);

	if (process.argv.includes("--subagent")) {
		// The worker agent's own definition grants write. Only the capability ceiling
		// in preset.ts stops it under plan; the implement run proves the test can pass.
		if (await canaryWritten("plan")) {
			console.log("FAIL: plan preset wrote a file through a subagent (check the ceiling in agent/extensions/preset.ts)");
			failures++;
		} else {
			console.log("ok:   plan preset cannot write through a subagent");
		}
		if (await canaryWritten("implement")) {
			console.log("ok:   implement preset can write through a subagent");
		} else {
			console.log("FAIL: implement preset could not write through a subagent, so the plan result above proves nothing");
			failures++;
		}
	}
} finally {
	rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `${failures} check(s) failed.` : "All model checks passed.");
process.exit(failures ? 1 : 0);
