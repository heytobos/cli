---
name: tobos-present
description: Build presentations as code with Tobos Present. Use when the user wants a talk, lecture, pitch or slide deck made, changed, rendered, presented or exported as a PDF, or mentions Tobos or `tobos`.
---

<!-- Installed by the `tobos` CLI and overwritten when it updates, so changes made here don't last. -->

# Tobos Present

Tobos hosts presentations that you write as code: one Svelte 5 file per scene, with beats (one click each) and GSAP animations. You build; Tobos checks every push, hosts the deck, and puts it on stage with a presenter view. There is no AI on Tobos's side and no MCP server: everything goes through the `tobos` command and git.

## Set up (once per machine)

```sh
npm i -g @tobos/cli               # the `tobos` command; needs Node 22.18+ and git
tobos login you@example.com       # e-mails the person a 6-digit code (and signs them up if new)
tobos login --code 123456         # the code they paste to you from the mail
```

Ask the person for their e-mail address first, then for the code in one line: it's in their e-mail, maybe in spam, and using it accepts https://tobos.ai/terms. Only they can read it; never guess or reuse one. It works for 10 minutes. In CI, set `TOBOS_TOKEN` instead.

## Start or continue a deck

```sh
tobos decks                       # the decks you can work on, by id
tobos new "Title of the talk"     # create one and clone it into ./<id>
tobos clone <id>                  # or clone an existing one
```

Then **read the deck's `AGENTS.md`**. It, `.tobos/FORMAT.md` and `master/GUIDE.md` are the instructions for everything that follows: the loop (`check` → `render` → look → `push`), the format, the slide master's layouts and rules.

## Follow the person

They decide what to make and how much you do: some build a deck one scene at a time, some want all of it at once. Do what they ask, at the size they ask. Don't ask what a talk is about, who it's for or how long it runs, and don't propose an outline they didn't ask for.

## Polls and forms

A scene can ask the room a poll or a short form, which people answer on their phones through the deck's join code: `<JoinCode/>` shows its QR code, and the poll's result shows on the projector at a beat you choose. See "Activities" in the deck's `.tobos/FORMAT.md`. The responses download from the deck's page as a CSV per show (one class or talk): a row per phone, a column per question.

## The story

A deck has one story: the talk as the speaker tells it, paragraph by paragraph, with scenes mentioned as Markdown links, `[Dartmouth College](scene:same-problem)`, or one of their beats, `[Dartmouth College](scene:same-problem/quote)` (the ids from deck.json; the label is the scene's title). What follows a mention, up to the next, is that scene's: the deck's page shows it under the stage, and the presenter sees it as speaker notes. The server holds it, not git, so there is no file to edit: the person types in it live on the deck's page, and you change it with `tobos story`, which reads and writes it on the server.

- `tobos story` prints it with a ¶ id per paragraph (`p4`). Read it again before each change: the person may be typing.
- Your changes apply at once, as the person's do, and the deck's page marks what you wrote. Change what the person asked you to, and leave the rest of their words as they are.
- An edit is anchored on the exact text it replaces, which has to occur once in the paragraph. If someone changed it meanwhile, the command exits with code 4 and the paragraph as it is now: anchor on that and try again.
- Set `TOBOS_AGENT` to your name (`claude`, `codex`): the page shows who wrote what.

## Commands

| Command                                                  | Does                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `tobos check`                                            | compile and check the deck, offline                    |
| `tobos push -m "…"`                                      | upload media, commit, push; the server checks it again |
| `tobos render scene/beat` · `scene` · `--all` · `--film` | PNGs of beats; pushes what changed first               |
| `tobos open [scene/beat] [--presenter]`                  | the deck in a browser; pushes what changed first       |
| `tobos open` (outside a deck)                            | Tobos in the browser, logged in: decks and templates   |
| `tobos export pdf`                                       | a PDF of every beat                                    |
| `tobos story`                                            | the story, by ¶ id                                     |
| `tobos story edit <¶> "old" "new"`                       | change it, anchored on the exact text                  |
| `tobos story add [--after <¶>] "…"` · `delete <¶>`       | add a paragraph, or delete one                         |

Every command takes `--json`. Exit codes: 0 ok, 1 error, 2 the deck has problems, 3 not logged in, 4 the story changed meanwhile.

When a command says a newer `tobos` is out, run `npm i -g @tobos/cli`; the next command updates this skill. When a plan's limit stops a command (Free hosts 3 decks), the error links to the billing page: give the person the link, since only they can buy Pro.
