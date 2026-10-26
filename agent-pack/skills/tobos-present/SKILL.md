---
name: tobos-present
description: Build presentations as code with Tobos Present. Use when the user wants a talk, lecture, pitch or slide deck made, changed, rendered, presented or exported as a PDF, or mentions Tobos or `tobos`.
---

<!-- Installed by the `tobos` CLI and overwritten when it updates, so changes made here don't last. -->

# Tobos Present

Tobos hosts presentations written as code: a deck is a git repository, one Svelte 5 file per scene, advancing one beat per click. You build it with the `tobos` command; Tobos checks every push, hosts the deck and puts it on stage. `tobos --help` lists every command, and each takes `--json`.

## Get to the deck

- `tobos decks` lists the decks and templates the person can work on, by id. `tobos clone <id>` gets one; `tobos new "Title"` starts one and clones it.
- A new deck starts from Tobos simple. The person's own templates, their house styles, are in `tobos decks`: start from one with `--from <id>`, and ask which when there are several.
- Then read the deck's `AGENTS.md`: it points to the loop, the format and the deck's slide master.

Exit code 3 means no one is logged in. Ask the person for their e-mail address and run `tobos login <email>`. Then ask, in one line, for the 6-digit code it mailed them (it may be in spam, and using it accepts https://tobos.ai/terms), and run `tobos login --code <code>`. In CI or a sandbox with no one to ask, `TOBOS_TOKEN` and `TOBOS_SERVER` stand in for the login.

## Follow the person

They decide what to make and how much of it you build: one scene at a time, or the whole deck at once. Build what they ask, at the size they ask, from what they have told you about the talk. When they ask how Tobos works or where to start, give them the tour, https://tobos.ai/tour, and nothing of your own: no explanation, no deck to try.

## What stays the person's

- **Exit code 5** is a plan's limit or an archived deck. Show the person the message as it is, which says what they can do, and wait for their answer. The deck stays in Tobos: a deck built elsewhere to upload later, media shrunk or hosted elsewhere to fit, or someone else's account would decide for them what is theirs to decide.
- **Archiving, opening again and deleting** a deck, and deleting a session's answers, are done by the person on the deck's page, also in a browser `tobos open` logged in.
- **People.** `tobos invite` puts on a deck only whom the person names, at the level they say: the mail goes to someone else, in the person's name. Can edit builds it with their own agent, can present presents it with its notes and polls, and can view sees the slides; on a template, can edit and can use.
- **The URL `tobos open` prints** opens once, for whoever opens it first: give it to the person unopened, and run the command again for another window or computer.

## The story

A deck's story is the talk as the speaker tells it, in paragraphs. What follows a mention of a scene, `[Title](scene:<id>)` or one of its beats, `[Title](scene:<id>/<beat>)`, up to the next mention, is that scene's: the presenter sees it as speaker notes. The server holds the story, not git: the person types in it on the deck's page, and you change it with `tobos story`.

- Read it again right before each change: the person may be typing.
- Change what the person asked, and keep the rest of their words as they are.
- An edit is anchored on exact text that occurs once in its paragraph. Exit code 4 means the paragraph changed meanwhile: anchor on it as the reply gives it, and try again.
- Set `TOBOS_AGENT` to your name (`claude`, `codex`), so the page shows what you wrote.
