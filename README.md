# Tobos CLI

The command line of [Tobos](https://tobos.ai), the office suite your coding agent works in. Your agent runs `tobos`; you tell your agent what you want.

```sh
npm i -g @tobos/cli
```

Node 22.18 or later. To set it up, paste this into Claude Code, Codex, OpenCode or another harness:

```
Read tobos.ai/start and set me up with Tobos.
```

## What's here

Everything `@tobos/cli` is built from, and the format it checks:

| Folder             | What                                                                          |
| ------------------ | ----------------------------------------------------------------------------- |
| `cli/`             | the `tobos` command                                                           |
| `deck/`            | the deck format: compiling and checking a deck. `deck/FORMAT.md` describes it |
| `present/`         | the engine that presents a deck, and its API for scenes (`@tobos/present`)    |
| `agent-pack/`      | the skill `tobos skill install` puts into your harness                        |
| `templates/tobos/` | Tobos standard, the full house style, which new decks start from              |
| `site/`            | tobos.ai's colours and typefaces, which the engine and Tobos standard use     |

```sh
pnpm install
pnpm check   # formatting, types and tests
pnpm build   # cli/dist/tobos.js
```

Each release on npm is built by `.github/workflows/publish.yml` from a commit here, and npm shows its provenance.

## Changes

This repository is a copy: Tobos is developed in a private repository, and every change to these folders is copied here as it lands. So pull requests can't be merged here. To report a bug or suggest a change, write to [hey@tobos.ai](mailto:hey@tobos.ai).

## Licence

[Functional Source License 1.1, Apache 2.0 future licence](LICENSE.md) (FSL-1.1-ALv2). You may use, copy and change this code for any purpose except a competing one: offering it, or something built on it, as a commercial product or service that substitutes for Tobos. Two years after each version is released, that version is also available under the Apache License 2.0. The typefaces in `site/src/lib/fonts/` are under the SIL Open Font License; their licences are next to them.
