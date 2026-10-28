# The agent pack

What an agent needs to work with Tobos, as plain files any harness can read. It is public, with the CLI that carries it, at github.com/heytobos/cli.

Each meaning lives in one document, and the others point to it:

| Document                        | Says                                                                         | Where it comes from                                                                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills/tobos-present/SKILL.md` | what Tobos is, how to get to a deck, and what stays the person's             | this folder, installed by `tobos skill install`                                                                                                       |
| a deck's `AGENTS.md`            | where the instructions are, and nothing that changes                         | `scaffold.ts`, committed once when the deck is made                                                                                                   |
| `.tobos/FORMAT.md`              | the loop in a copy and the commands for the five verbs, then the deck format | `cli/src/format.ts` (the verbs from `code/deck/src/verbs.ts`), then `code/deck/FORMAT.md` as the server has it, written by `tobos pull`               |
| `master/GUIDE.md`               | the deck's own layouts, components and rules                                 | the deck's master, copied from its template                                                                                                           |
| `tobos --help`                  | every command and exit code                                                  | `code/cli/src/main.ts`                                                                                                                                |
| the chat guide                  | the same for a chat, with tools instead of commands                          | `code/app/src/lib/server/mcp-guide.md`, the tools from `code/deck/src/verbs.ts`, the skill's "Follow the person" and "Folders", and FORMAT.md's parts |

- The CLI carries this folder (`cli/build.ts`), and `tobos skill install` copies it to `~/.claude/skills/tobos-present/` (Claude Code; follows `CLAUDE_CONFIG_DIR`) and `~/.agents/skills/tobos-present/` (Codex), which other harnesses read too. A `VERSION` file beside each copy records the CLI that wrote it, and every later CLI replaces an older copy before it runs a command (`cli/src/skill.ts`). Servers name the latest CLI on every response (`tobos-latest-cli`), and an older CLI says so, so a change to the skill reaches people with the next CLI they install.
- A deck's `AGENTS.md` stays as it was written, so what changes goes into `.tobos/FORMAT.md`, which every pull brings up to date.
