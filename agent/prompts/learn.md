---
description: Turn a lesson from this session into a charter patch at the right layer — you draft, the person approves
argument-hint: "[the lesson — omit to look back over this session]"
---
Run the learning flywheel. The lesson: ${@:-none given, so find it first}.

If this repository has its own procedure for adding a rule, read it and follow
it instead. Look for a `learn` command or skill, or a charter-versioning rule,
under `.claude/` or `.agents/`.

1. **Find the lesson.** With none given, search the transcript of this session,
   not your recall, for four signals:
   - the person corrected the same thing twice
   - the same failure happened twice
   - you asked a question that a rule could answer
   - a review finding came back after a fix
2. **Say it in one sentence.** If it needs two sentences, it is two lessons.
   Take the first and say the second exists.
3. **Apply the bar.** Promote on the third occurrence. Promote on the first if
   it risks money, data or a secret. Below the bar, report the count and stop.
   "No lesson, nothing recurred" is a correct and common result.
4. **Check the code.** Find two places that already follow the lesson. If the
   code contradicts it, the rule would be aspirational. Propose the code change
   first, or scope the rule to the part of the code that complies.
5. **Pick the narrowest layer where it is true.**
   - every repo, how work gets done: `~/.pi/agent/AGENTS.md`
   - this repo: its `AGENTS.md` or `CLAUDE.md`, or a rule file under
     `.claude/rules/` with `paths:` frontmatter for the files it governs
   - a sequence of steps: a skill, not a rule
   - must happen every time: a hook, a test or a gate, not prose
6. **Prefer an edit to an addition.** Search for the closest existing rule and
   tighten it before you write a new one.
7. **Draft the patch.** Mark the tier. IRON means refuse on violation. GOLDEN
   means a default with a named exception. PREF means a linter enforces it.
   Give the reason: the correction or incident that produced the rule.
8. **Show the exact diff and the placement reason, then stop.** Apply it only
   after the person approves. Then name the rung that carries the rule.
