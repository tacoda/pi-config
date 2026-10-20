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
| what the work must respect | the repo's `AGENTS.md` and `.agents/` |
| a phase's model, thinking level or tool grant | `~/.pi/agent/presets.json` |
| a reusable capability | `~/.agents/skills/` (shared with other harnesses) |
| a hard refusal | `~/.pi/agent/extensions/` |
| project machinery a person must approve | the repo's `.pi/extensions/`, behind the trust prompt |

## Phases

`/preset plan|implement|review` (Ctrl+Shift+U cycles). A phase carries its own
thinking level, tool grant and brief. `plan` was never handed the editing tools,
so it cannot write even if it tries — that is the point of a grant over a
promise. Prompt templates `/plan` and `/review` are one-shot kickoffs; the
preset is the standing configuration.

## Rules are carried at rungs

A rule is only as real as the mechanism that carries it, and the honest number
matters more than the high one:

- **prose** — written here or in a repo's `AGENTS.md`. Nothing enforces it.
- **tool grant** — a preset never handed the phase the tool.
- **extension refusal** — `tool_call` blocks the call. `protected-paths` is
  this. A project-local `.pi/extensions/` file is the same rung but travels
  with the repo, behind the trust prompt.
- **out of reach** — a git hook or CI that neither the agent nor the harness
  can route around.

Never claim a rung you do not carry. A rule nobody enforces is survivable; a
rule everybody believes is enforced is not. When a shortcut is the right call,
say what it cannot do.

## Conventions that travel

**Write the reason, not the rule.** A comment restating the code is noise. A
comment naming the bug that gave the code its shape is the only reason the next
person leaves it alone.

**A failure says what to do.** Name the file, the setting or the command that
fixes it, not just that something went wrong.

**Leave a runnable check behind** for any non-trivial logic: a branch, a
parser, a money path, a gate. Run the project's cheap test before claiming
done. A check that cannot fail is not a check.

**No AI attribution.** No commit message, pull request, changelog or release
note names a model or adds a Co-Authored-By trailer for one. The person who ran
the session is the author.

**Delegate when it pays.** A reviewer or scout subagent on a finished diff
costs little and sees what the writer could not. Ask for it in plain language;
don't spawn one for a one-line edit.

## What not to do

Do not add a dependency for what the standard library already does. Do not
register a tool an installed package already provides. Do not put a target
repository's conventions in a global file — that is the repo's `AGENTS.md`
saying what the work must respect, and this file saying how.
