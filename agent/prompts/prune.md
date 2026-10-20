---
description: Audit a charter for stale rules and propose keep, rewrite, narrow, merge or archive — the person approves each change
argument-hint: "[file or directory — defaults to this repo's charter]"
---
Run the pruning flywheel on ${@:-this repository's charter: its AGENTS.md, CLAUDE.md and .claude/rules}.

If this repository has its own pruning procedure, read it and follow it
instead. Look for a `prune` command or skill under `.claude/` or `.agents/`.

Ask one question of each rule: does the code still show this? Answer with
evidence. Give a file and line that follows the rule, one that contradicts it,
or a glob that matches no file. A rule with no evidence either way is a finding
too.

Sort each stale rule into one class:

- **factually wrong** — it names a library, path or command that is gone.
- **aspirational** — the code never followed it.
- **domain-stale** — it uses an old name for something the product renamed.
- **process-stale** — it describes a step, channel or sign-off nobody uses.

Also flag a path-scoped rule whose globs match no file, and an always-on rule
that only one directory needs. Flag two rules on one topic, and a preference
with no linter behind it.

Report a table: rule, class, evidence, proposed action. The actions are keep,
rewrite, narrow, merge and archive. List the ten strongest findings at most.
Then stop and wait for approval.

On approval, archive instead of deleting. Move a retired rule file to an
`archive/` directory beside it. Its first line names the date, the reason and
the principle that survives. For a line removed from an `AGENTS.md`, put the
reason in the commit message.
