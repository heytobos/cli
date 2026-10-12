# The agent pack

What an agent needs to work with Tobos, as plain files any harness can read. It is public, with the CLI that carries it, at github.com/heytobos/cli.

- `skills/tobos-present/SKILL.md`: the skill a harness installs (Claude Code, Codex and OpenCode all read `SKILL.md`). It covers installing the CLI, logging in, and getting to a deck, then hands over to the deck's own `AGENTS.md`.
- The CLI carries this folder (`cli/build.ts`), and `tobos skill install` copies it to `~/.claude/skills/tobos-present/` (Claude Code; follows `CLAUDE_CONFIG_DIR`) and `~/.agents/skills/tobos-present/` (Codex), which other harnesses read too. A `VERSION` file beside each copy records the CLI that wrote it, and every later CLI replaces an older copy before it runs a command (`cli/src/skill.ts`). Servers name the latest CLI on every response (`tobos-latest-cli`), and an older CLI says so, so a change to the skill reaches people with the next CLI they install.
- Each deck carries its own `AGENTS.md` (the server writes it when the deck is created), its slide master with the master's guide in `master/`, and `tobos clone` writes the format into `.tobos/`.
