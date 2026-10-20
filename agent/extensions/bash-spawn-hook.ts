/**
 * Bash Spawn Hook — polyglot web engineer edition.
 *
 * Sources shell rc files and version-manager shims before every agent-run
 * bash command, so `node`, `ruby`, `python`, `go`, `php`, `composer`,
 * `bundle`, `pnpm`, etc. resolve the same way they do in your interactive shell.
 *
 * Adjust the preamble if you don't use one of these tools; a missing file is
 * silently ignored via `[ -f ... ] && source ...`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashTool } from "@earendil-works/pi-coding-agent";

const PREAMBLE = [
	// login/profile
	'[ -f "$HOME/.profile" ] && . "$HOME/.profile"',
	'[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"',
	'[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc" 2>/dev/null || true',
	// version managers — enable only the ones you use; harmless if absent
	'[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"',
	'command -v rbenv >/dev/null 2>&1 && eval "$(rbenv init - bash)"',
	'command -v pyenv >/dev/null 2>&1 && eval "$(pyenv init -)"',
	'command -v goenv >/dev/null 2>&1 && eval "$(goenv init -)"',
	'[ -s "$HOME/.asdf/asdf.sh" ] && . "$HOME/.asdf/asdf.sh"',
	'command -v mise >/dev/null 2>&1 && eval "$(mise activate bash)"',
].join("\n");

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	const bashTool = createBashTool(cwd, {
		spawnHook: ({ command, cwd, env }) => ({
			command: `${PREAMBLE}\n${command}`,
			cwd,
			env: { ...env, PI_SPAWN_HOOK: "1" },
		}),
	});

	pi.registerTool({
		...bashTool,
		execute: async (id, params, signal, onUpdate, _ctx) => {
			return bashTool.execute(id, params, signal, onUpdate);
		},
	});
}
