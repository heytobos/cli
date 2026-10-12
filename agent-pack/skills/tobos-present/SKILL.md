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
tobos decks                       # the decks you can work on
tobos new "Title of the talk"     # create one and clone it into ./<slug>
tobos clone account/deck          # or clone an existing one
```

Then **read the deck's `AGENTS.md`**. It, `.tobos/FORMAT.md` and `master/GUIDE.md` are the instructions for everything that follows: the loop (`check` → `render` → look → `push`), the format, the slide master's layouts and rules.

## Follow the person

They decide what to make and how much you do: some build a deck one scene at a time, some want all of it at once. Do what they ask, at the size they ask. Don't ask what a talk is about, who it's for or how long it runs, and don't propose an outline they didn't ask for.

## Commands

| Command                                                  | Does                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `tobos check`                                            | compile and check the deck, offline                    |
| `tobos push -m "…"`                                      | upload media, commit, push; the server checks it again |
| `tobos render scene/beat` · `scene` · `--all` · `--film` | PNGs of beats; pushes what changed first               |
| `tobos open [scene/beat] [--presenter]`                  | the deck in a browser; pushes what changed first       |
| `tobos open` (outside a deck)                            | Tobos in the browser, logged in: decks and templates   |
| `tobos export pdf`                                       | a PDF of every beat                                    |

Every command takes `--json`. Exit codes: 0 ok, 1 error, 2 the deck has problems, 3 not logged in.

When a command says a newer `tobos` is out, run `npm i -g @tobos/cli`; the next command updates this skill. When a plan's limit stops a command (Free hosts 3 decks), the error links to the billing page: give the person the link, since only they can buy Pro.
