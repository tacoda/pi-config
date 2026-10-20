# pi-config

My configuration for the [pi coding agent](https://github.com/earendil-works/pi).
The files under `agent/` are linked into pi's agent directory (`~/.pi/agent`).
`install.ts` installs everything else pi needs. The repository does not commit it.

## Set up a machine

Prerequisites:

| Tool | Why | Install |
|---|---|---|
| Node.js 24.13+ and npx | pi, packages, the skills CLI, and this repo's scripts | `mise use -g node@24` |
| pi | the agent | `npm install -g @earendil-works/pi-coding-agent` |
| Claude Code CLI | `pi-claude-bridge` runs it to use the Claude subscription | install it, then run `claude` once to log in |
| rtk | rewrites bash commands for smaller output | `brew install rtk` |
| graphify | codebase knowledge-graph skill | `uv tool install graphifyy` |
| chunk (optional) | CircleCI sidecar skill | CircleCI's install docs |

Then:

```sh
./install.ts   # link agent/, install packages, extensions and skills
./check.ts     # free: links, packages, skills, secrets, extension tests
./verify.ts    # uses plan quota: the config reaches the model
```

Node runs the scripts as TypeScript by stripping the types, so Node 24.13 is
the floor. There is no build step, no `package.json` and no dependency. Node
does not check the types, and only erasable syntax works: no enums, namespaces
or constructor parameter properties. `lib.ts` holds the shared logic.

`install.ts` is safe to re-run. It skips what is already in place and never
upgrades anything. Before it replaces a file in `~/.pi/agent`, it moves the old
file to `~/.pi/agent-removed/pi-config-backup-<timestamp>/`.

## Use it

### Phases and pacing

Pick a phase with `/preset plan`, `/preset implement` or `/preset review`.
Ctrl+Shift+U cycles them. Each phase sets the thinking level, the tool grant
and a brief. The `plan` grant leaves out edit, write and bash. The `review`
grant includes bash and leaves out edit and write.

Pacing is separate from the phase. Say "paired", "solo" or "autopilot" in a
prompt. Paired is the default. `agent/AGENTS.md` defines each mode, and
nothing enforces it.

### Prompts

| Command | What it does |
|---|---|
| `/plan <change>` | Plans a change without writing it. Pair it with `/preset plan`. |
| `/review [scope]` | Reviews the finished diff. Pair it with `/preset review`. |
| `/learn [lesson]` | Turns a lesson into a charter patch at the right layer. With no lesson, it searches the session for one. It shows the diff and waits for approval. |
| `/prune [path]` | Audits a charter for stale rules. It proposes keep, rewrite, narrow, merge or archive, and waits for approval. |

A repo adds its own commands in `.pi/prompts/`, or in `.claude/commands/`
through `claude-charter`.

### Skills

pi lists every skill by name and description in the system prompt. The model
loads a skill when the task matches it. To force one, type
`/skill:<name> [request]`.

Skills come from three places:

- `~/.agents/skills/` — the shared skills in `skills.txt`. Other harnesses
  read this directory too.
- `~/.pi/agent/skills/` — `graphify` and other pi-only skills.
- the repo — `.pi/skills/`, `.agents/skills/`, and `.claude/skills/` through
  `claude-charter`.

| Source in `skills.txt` | Start with |
|---|---|
| `tacoda/constraint-engineering` | `harness-engineering`, which routes to the charter, codebase, primitives, operations, harness and orchestration skills |
| `mattpocock/skills` | `tdd`, `diagnosing-bugs`, `grilling`, `handoff`, `retro`, `to-spec`, `to-tickets` |
| `addyosmani/agent-skills` | `spec-driven-development`, `code-review-and-quality`, `security-and-hardening`, `incremental-implementation` |
| `JuliusBrussee/caveman` | `caveman` for compressed output, `caveman-commit`, `caveman-review` |
| `humanlayer/skills`, `vercel-labs/skills` | `show-me`, `find-skills` |

The `ponytail` package is always on. Change its level with
`/ponytail lite|full|ultra`. Use `/skill:ponytail-review` on a diff and
`/skill:ponytail-audit` on a whole repo.

### Subagents

`pi-subagents` adds the `subagent` tool. Ask for one in plain words, for
example "run a reviewer on this diff". The builtin agents are `scout`,
`researcher`, `worker`, `reviewer`, `oracle` and `delegate`. Under
`pi-claude-bridge`, run them with `async: true`. A preset caps each subagent's
tools at the preset's grant. Only one agent writes to a worktree at a time.

### Claude Code charters

A repo built for Claude Code keeps its charter in `.claude/`. Under pi, most of
that charter never reaches the model. `claude-charter` loads it, but only in a
repo you trust explicitly:

1. Open pi in the repo.
2. Run `/trust` and choose **Trust**.
3. Restart pi, or run `/reload`.

In a trusted repo, the extension does four things:

- A rule in `.claude/rules/` with no `paths:`, or with `**`, loads with the
  context files, like `CLAUDE.md`.
- A rule with `paths:` globs arrives with the first read, edit or write of a
  matching file. It arrives again after a compaction.
- `.claude/skills/` and `.claude/commands/` become skills and prompt templates.
- PreToolUse and PostToolUse hooks in `.claude/settings.json` and
  `settings.local.json` run on pi's built-in tools. A hook that exits 2 blocks
  the call, as in Claude Code.

pi's own trust flag is not enough for this gate. pi trusts a folder with no
`.pi/` resources without asking, so a cloned repo's hooks would run unasked.
After you edit a rule or a hook, run `/reload`.

The extension also guards untrusted repos. `pi-claude-bridge` starts Claude
Code with the repo's settings, and Claude Code runs the repo's hooks with no
trust check. A repo can declare hooks and have no `/trust` entry. There,
`claude-charter` holds each prompt while the provider is `claude-bridge`. You
choose "Do not send" or "Send anyway, for this session only". In print mode,
it refuses the prompt and prints the fix on stderr.

### Other tools from packages

| Package | What it adds |
|---|---|
| `pi-web-access` | `web_search` and `fetch_content` |
| `rpiv-ask-user-question` | `ask_user_question`, so the model asks instead of guessing |
| `rpiv-todo` | a todo list the model keeps |
| `pi-goal-x` | `/goal` for goals with tracked progress |
| `pi-lens` | LSP diagnostics, linters and code navigation |
| `agent-simple-english` | the writing-rule checks on prose |
| `cc-safety-net` | blocks destructive commands and access to secret files |
| `pi-btw` | `/btw` for side conversations |
| `pi-prompt-template-model` | `model:` and `skill:` frontmatter in prompt templates |
| `pi-intercom` | messages between pi sessions on this machine |
| `pi-advisor-flow` | `ask_advisor`, after you configure an advisor model |
| `pi-powerline-footer` | the status bar |

## Credentials

The repository holds no credentials. `.githooks/pre-commit` refuses a commit
that looks like it adds one (`scan-secrets.ts`).

- Provider keys (OpenAI and others): pi auth, `/login` in pi. pi stores them in
  `~/.pi/agent/auth.json`, which is never linked or committed.
- Claude: the subscription through `pi-claude-bridge` and the Claude Code login.
- context7: export `CONTEXT7_API_KEY`. `agent/mcp.json` references it as
  `${CONTEXT7_API_KEY}`. Until you set it, `pi mcp list` shows context7 as failed.

## What is here

| Path | What it is |
|---|---|
| `agent/AGENTS.md` | How work gets done, in every pi session |
| `agent/APPEND_SYSTEM.md` | Response style: simplified technical English (ASD-STE100 subset) |
| `agent/settings.json` | Default provider and model, theme, pi packages |
| `agent/presets.json` | `plan`, `implement`, `review` phases: thinking level, tool grant, brief |
| `agent/mcp.json` | MCP servers (context7) |
| `agent/claude-bridge.json` | `pi-claude-bridge` settings |
| `agent/extensions/preset.ts` | Applies presets and caps subagent tools at the preset's grant |
| `agent/extensions/protected-paths.ts` | Refuses writes to secrets, lockfiles, dependency and build dirs |
| `agent/extensions/git-checkpoint.ts` | Stashes a checkpoint per turn so `/fork` can restore code |
| `agent/extensions/bash-spawn-hook.ts` | Loads shell rc files and version managers before each bash call |
| `agent/extensions/claude-charter/` | Loads a trusted repo's `.claude/` charter: rules, skills, commands, tool hooks |
| `agent/prompts/` | `/plan`, `/review`, `/learn` and `/prune` |
| `agent/themes/` | Themes. `check-theme.ts` validates one and checks contrast |
| `skills.txt` | Shared skills, by source, installed to `~/.agents/skills` |

Installed, not committed:

- **pi packages**: the `packages` list in `settings.json`. See *Use it*.
- **rtk extension**: `rtk init -g --agent pi` writes `~/.pi/agent/extensions/rtk.ts`.
- **graphify skill**: `graphify install --platform pi`.
- **chunk-sidecar skill**: `chunk skill install`.

## Change something

- **Edit a tracked file:** edit it here or in `~/.pi/agent`. It is the same
  file. Run `/reload` in pi.
- **Add an extension, prompt or theme:** put it under `agent/`, then run
  `./install.ts`. A rename or a deletion here leaves a dead link, and
  `./install.ts` removes it.
- **Test extension logic:** put the pure logic in a file with no pi imports,
  and the tests beside it as `*.test.ts`. `./check.ts` runs every one.
- **Add a pi package:** `pi install <source>`. pi writes it into
  `settings.json`, which is this repository's file, so it shows up in
  `git diff`.
- **Add a skill:** `npx skills add <owner/repo> -g -a pi -s <name> -y`, then
  add the name to its source line in `skills.txt`.

pi also writes `lastChangelogVersion` to `settings.json` and
`startupNoticeShown` to `claude-bridge.json`. Expect those in `git diff` now
and then.

## Known limits

- **The subagent cap is a policy inside the pi process, not a sandbox.**
  `preset.ts` registers a pi-subagents capability ceiling. If that module does
  not load, presets remove the `subagent` tool instead.
- **Foreground subagents fail under `pi-claude-bridge`.** The child does not
  load the bridge's session hooks. Use `async: true`.
- **Claude Code settings still apply inside bridge turns.** The bridge runs
  Claude Code with user and project settings. Hooks in `~/.claude/settings.json`
  and a repo's `.claude/settings.json` fire unless they match on tool names.
- **The untrusted-repo guard covers typed prompts only.** It acts on pi's
  `input` event. A turn that an extension starts with a custom message skips
  it. A subagent in an unguarded repo stops at the guard, so run `/trust`
  first. In print mode, pi exits 0 even when the guard refuses the prompt.
- **`claude-charter` does not run SessionStart, Stop or UserPromptSubmit
  hooks.** Under the bridge, Claude Code already runs the first two, and a
  second run doubles slow checks. Under another provider, none of the three
  run.
- **A repo skill or command loses a name collision.** pi adds extension paths
  after user paths and keeps the first skill of each name. A repo's
  `.claude/skills/implement` loses to the shared `implement` skill, and pi
  prints a collision warning.
- **`claude-charter` supports part of the hook output contract.** Exit codes,
  `permissionDecision` deny and ask, and `decision: block` work. `updatedInput`
  does not. PostToolUse hooks receive `{ success, output }`, not Claude Code's
  full tool response.
- **A read inside a codemode script attaches no path-scoped rule.** The result
  goes to the script, not the model. A later direct read attaches it.
