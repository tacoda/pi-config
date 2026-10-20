# pi-config

My configuration for the [pi coding agent](https://github.com/earendil-works/pi).
The files under `agent/` are linked into pi's agent directory (`~/.pi/agent`).
Everything else pi needs is installed by `install.ts`, not committed.

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
./check.ts     # free: links, packages, skills, secrets
./verify.ts    # uses plan quota: the config reaches the model
```

The scripts are TypeScript that Node runs directly by stripping the types, which
is why Node 24.13 is the floor. There is no build step, no `package.json` and no
dependency. Node does not check the types, and only erasable syntax works: no
enums, namespaces or constructor parameter properties. `lib.ts` holds the shared
logic.

`install.ts` is safe to re-run. It skips what is already in place and never
upgrades anything. Before it replaces a file in `~/.pi/agent`, it moves the old
file to `~/.pi/agent-removed/pi-config-backup-<timestamp>/`.

## Credentials

None are in this repository, and `.githooks/pre-commit` refuses a commit that
looks like it adds one (`scan-secrets.ts`).

- Provider keys (OpenAI and others): pi auth, `/login` in pi. They are stored in
  `~/.pi/agent/auth.json`, which is never linked or committed.
- Claude: the subscription through `pi-claude-bridge` and the Claude Code login.
- context7: export `CONTEXT7_API_KEY`. `agent/mcp.json` references it as
  `${CONTEXT7_API_KEY}`. Until it is set, `pi mcp list` shows context7 as failed.

## What is here

| Path | What it is |
|---|---|
| `agent/AGENTS.md` | How work gets done, in every pi session |
| `agent/APPEND_SYSTEM.md` | Response style: simplified technical English (ASD-STE100 subset) |
| `agent/settings.json` | Default provider and model, theme, pi packages |
| `agent/presets.json` | `plan`, `implement`, `review` phases: thinking level, tool grant, brief |
| `agent/mcp.json` | MCP servers (context7) |
| `agent/claude-bridge.json` | `pi-claude-bridge` settings |
| `agent/extensions/preset.ts` | Applies presets; caps subagent tools at the preset's grant |
| `agent/extensions/protected-paths.ts` | Refuses writes to secrets, lockfiles, dependency and build dirs |
| `agent/extensions/git-checkpoint.ts` | Stashes a checkpoint per turn so `/fork` can restore code |
| `agent/extensions/bash-spawn-hook.ts` | Loads shell rc files and version managers before each bash call |
| `agent/prompts/` | `/plan` and `/review` kickoffs |
| `agent/themes/` | Themes; `check-theme.ts` validates one and checks contrast |
| `skills.txt` | Shared skills, by source, installed to `~/.agents/skills` |

Installed, not committed:

- **pi packages** (from `settings.json`): `pi-subagents`, `pi-claude-bridge`, `ponytail`.
- **rtk extension**: `rtk init -g --agent pi` writes `~/.pi/agent/extensions/rtk.ts`.
- **graphify skill**: `graphify install --platform pi`.
- **chunk-sidecar skill**: `chunk skill install`.

## Change something

- **Edit a tracked file:** edit it here or in `~/.pi/agent`; it is the same file.
  Run `/reload` in pi.
- **Add an extension, prompt or theme:** put it under `agent/`, then run `./install.ts`.
  Renaming or deleting a file here leaves a dead link; `./install.ts` removes it.
- **Add a pi package:** `pi install <source>`. pi writes it into `settings.json`,
  which is this repository's file, so it shows up in `git diff`.
- **Add a skill:** `npx skills add <owner/repo> -g -a pi -s <name> -y`, then add the
  name to its source line in `skills.txt`.

pi also writes `lastChangelogVersion` to `settings.json` and `startupNoticeShown`
to `claude-bridge.json`. Expect those in `git diff` now and then.

## Known limits

- **The subagent cap is a policy inside the pi process, not a sandbox.**
  `preset.ts` registers a pi-subagents capability ceiling. If that module does
  not load, presets remove the `subagent` tool instead.
- **Foreground subagents fail under `pi-claude-bridge`.** The child does not load
  the bridge's session hooks. Use `async: true`.
- **Claude Code settings still apply inside bridge turns.** The bridge runs
  Claude Code with user and project settings, so hooks in `~/.claude/settings.json`
  and a repo's `.claude/settings.json` fire unless they match on tool names.
