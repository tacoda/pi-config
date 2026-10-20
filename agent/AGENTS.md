<!-- voice-register: informational -->

# How work gets done

This file rides along in every pi session, in every repository. It says **how
work gets done**. The repository's own `AGENTS.md` says **what the work must
respect**, and the two never swap: nothing here names a project, and nothing
project-specific belongs here.

## Where a change belongs

| You are changing | It goes in |
|---|---|
| how work gets done, everywhere | this file, `~/.pi/agent/` |
| what the work must respect | the repo's `AGENTS.md`, `.agents/`, or its `.claude/` charter |
| a phase's model, thinking level or tool grant | `~/.pi/agent/presets.json` |
| a reusable capability | `~/.agents/skills/` (shared with other harnesses) |
| a hard refusal | `~/.pi/agent/extensions/` |
| project machinery a person must approve | the repo's `.pi/extensions/`, behind the trust prompt |

A lesson from this session goes through `/learn`, which picks the row.

## Phases and pacing

`/preset plan|implement|review` (Ctrl+Shift+U cycles). A phase carries its own
thinking level, tool grant and brief. `plan` was never handed the editing tools,
so it cannot write even if it tries — that is the point of a grant over a
promise. Prompt templates `/plan` and `/review` are one-shot kickoffs. The
preset is the standing configuration.

Pacing is how often the person sees the work, and the person sets it in plain
words. Phases say what the work is. Pacing says how often it stops.

- **paired** (the default) — stop at each phase boundary and show the artifact:
  the plan, the diff, the evidence.
- **solo** — run to the end. Stop only for an interrupt or a destructive step.
- **autopilot** — run to the end and keep an assumption log: every fork taken
  without asking, listed in the final report. An empty log means the run hid
  its choices.

After a miss, step back to paired. Nothing enforces pacing. It is prose.

## Rules are carried at rungs

A rule is only as real as the mechanism that carries it, and the honest number
matters more than the high one:

- **prose** — written here or in a repo's `AGENTS.md`. Nothing enforces it.
- **tool grant** — a preset never handed the phase the tool.
- **extension refusal** — `tool_call` blocks the call. `protected-paths` is
  this. `claude-charter` runs a repo's `.claude/settings.json` hooks at this
  rung, once you trust the repo with `/trust`. A project-local
  `.pi/extensions/` file is the same rung but travels with the repo, behind
  the trust prompt.
- **out of reach** — a git hook or CI that neither the agent nor the harness
  can route around.

Never claim a rung you do not carry. A rule nobody enforces is survivable. A
rule everybody believes is enforced is not. When a shortcut is the right call,
say what it cannot do.

## Conventions that travel

**Write the reason, not the rule.** A comment restating the code is noise. A
comment naming the bug that gave the code its shape is the only reason the next
person leaves it alone.

**A failure says what to do.** Name the file, the setting or the command that
fixes it, not just that something went wrong.

**Leave a runnable check behind** for any non-trivial logic: a branch, a
parser, a money path, a gate. A check that cannot fail is not a check.

**Evidence before a claim.** Done, passing, fixed and green each need a command
run this turn, after the last edit, with its output read. One claim needs one
command: a clean lint says nothing about the tests. Read the exit code of the
command itself, not of `cmd | tail`. A subagent's "done" is a claim, so check
the diff or the external state yourself. If nothing could verify it, say "not
verified".

**Ask, do not guess.** A request can leave a choice that changes behavior, with
nothing on disk to settle it. Stop before that choice becomes code. First read
where the answer would live: the rules, the code, recent commits.

If the answer is not there, ask one question with `ask_user_question`. Give two
or three options named by their consequence, the one you recommend and why,
and what a wrong guess costs. Ask one question per interrupt. "I assumed X,
please confirm" after the work ends is a guess, not a question.

**One writer at a time.** Read-only work — scouts, reviewers, research — fans
out freely. Only one agent writes to a worktree at once. While a writing child
runs, the parent does not edit. A writing child owns a whole phase. It
re-derives its state from git, the tracker and the files, not from a briefing.

**Convert, then clear.** The session forgets everything the window holds. Before
ending one that taught something, write the durable part where it is true.
Promote a correction on its third time, or on its first if it risks money, data
or a secret. Write a rule only for what the code already shows, because an
aspirational rule teaches the agent that rules are optional.

**No AI attribution.** No commit message, pull request, changelog or release
note names a model or adds a Co-Authored-By trailer for one. The person who ran
the session is the author.

**Delegate when it pays.** A reviewer or scout subagent on a finished diff
costs little and sees what the writer could not. Ask for it in plain language.
Do not spawn one for a one-line edit.

## What not to do

Do not add a dependency for what the standard library already does. Do not
register a tool an installed package already provides. Do not put a target
repository's conventions in a global file. The repo's `AGENTS.md` says what the
work must respect, and this file says how.
