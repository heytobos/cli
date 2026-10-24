---
name: tobos-present
description: Build presentations as code with Tobos Present. Use when the user wants a talk, lecture, pitch or slide deck made, changed, rendered, presented or exported as a PDF, or mentions Tobos or `tobos`.
---

<!-- Installed by the `tobos` CLI and overwritten when it updates, so changes made here don't last. -->

# Tobos Present

Tobos hosts presentations that you write as code: one Svelte 5 file per scene, with beats (one click each) and GSAP animations. You build; Tobos checks every push, hosts the deck, and puts it on stage with a presenter view. There is no AI on Tobos's side, and no MCP server in a harness: everything goes through the `tobos` command and git.

## Set up (once per machine)

```sh
npm i -g @tobos/cli               # the `tobos` command; needs Node 22.18+ and git
tobos login you@example.com       # e-mails the person a 6-digit code (and signs them up if new)
tobos login --code 123456         # the code they paste to you from the mail
```

Ask the person for their e-mail address first, then for the code in one line: it's in their e-mail, maybe in spam, and using it accepts https://tobos.ai/terms. Only they can read it; never guess or reuse one. It works for 10 minutes. In CI or a sandbox with no login, set `TOBOS_TOKEN` to the token `tobos login` stored (and `TOBOS_SERVER`, if not tobos.ai) instead.

## Start or continue a deck

```sh
tobos decks                       # the decks you can work on, by id
tobos new "Title of the talk"     # create one and clone it into ./<id>
tobos clone <id>                  # or clone an existing one
tobos pull                        # in a clone: the latest pushes and format guide
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

| Command                                                  | Does                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `tobos check` · `--types`                                | compile and check the deck, offline; `--types`: TypeScript too |
| `tobos push -m "…"`                                      | upload media, commit, push; the server checks it again         |
| `tobos render scene/beat` · `scene` · `--all` · `--film` | PNGs of beats; pushes what changed first                       |
| `tobos open [scene/beat] [--presenter]`                  | the deck in a browser; pushes what changed first               |
| `tobos open` (outside a deck)                            | a browser login, once: show the person its link and code       |
| `tobos export pdf`                                       | a PDF of every beat                                            |
| `tobos story`                                            | the story, by ¶ id                                             |
| `tobos story edit <¶> "old" "new"`                       | change it, anchored on the exact text                          |
| `tobos story add [--after <¶>] "…"` · `delete <¶>`       | add a paragraph, or delete one                                 |
| `tobos new "Title" --from <id>`                          | a deck from that template (default: the person's own)          |
| `tobos new "Our brand" --template`                       | a new template: a copy of the default, or of `--from`          |
| `tobos whoami` · `tobos logout`                          | who is logged in, on which server; or log this machine out     |
| `tobos skill install`                                    | this skill, where the person's harnesses read skills           |
| `tobos people`                                           | who is on it, what each may do, when a waiting invite lapses   |
| `tobos invite <email> --can edit` · `present` · `view`   | put someone on it; they get a mail (a template: edit · `use`)  |
| `tobos uninvite <email>`                                 | take them off; their access ends at once                       |

Invite only whom the person names, at the level they say: the mail goes to someone else, from the person's name. An invite nobody logs in with lapses after 14 days (`tobos people` says when). Inviting them again before then sends no mail and doesn't move the date; once it has lapsed, and they are gone from `tobos people`, invite them again if the person still wants them on it. Only the deck's owner puts people on it and takes them off; anyone else who may edit or present it, or is on a template, sees the owner and themselves in `tobos people`, a deck's viewers no one, and anyone leaves with `tobos uninvite` and their own address. Can edit builds the deck with their own agent and turns its link on or off; can present presents it with its notes and polls; can view sees the slides only. A template is shared the same way, at can edit or can use (`--can use`): using it is seeing its gallery and starting decks from it.

The URL `tobos open` prints opens once, for whoever opens it first: don't fetch it to check it, and run the command again for another window or another computer.

Every command takes `--json`. Exit codes: 0 ok, 1 error, 2 the deck has problems, 3 not logged in, 4 the story changed meanwhile, 5 a plan's limit or an archived deck.

When a command says a newer `tobos` is out, run `npm i -g @tobos/cli`; the next command updates this skill.

Exit code 5 means the person decides what happens next: a plan's limit (Free keeps 3 decks open at a time, and only Pro lets people besides the owner edit them), or an archived deck. Show them the message, which says what they can do (archive a deck on its page to make room, open one again, or buy Pro; or, on someone else's deck, ask its owner), and wait for their answer. Don't work around it: no deck built outside Tobos to upload later, no media shrunk or hosted elsewhere, no one else's account. An archived deck can still be cloned, read and shared, but takes no pushes and can't be presented.

Archiving a deck, opening it again, deleting it, and deleting a session with its answers are the person's own, on the deck's page: leave them to the person, also in a browser `tobos open` logged in.
