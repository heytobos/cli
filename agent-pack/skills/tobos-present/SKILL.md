---
name: tobos-present
description: Build presentations as code with Tobos Present. Use when the user wants a talk, lecture, pitch or slide deck made, changed, rendered, presented or exported as a PDF, or mentions Tobos or `tobos`.
---

<!-- Installed by the `tobos` CLI and overwritten when it updates, so changes made here don't last. -->

# Tobos Present

Tobos hosts presentations written as code: a deck is a folder of files, one Svelte 5 file per scene, advancing one beat per click. You build it with the `tobos` command, which needs no git; Tobos checks every push, keeps every version, hosts the deck and puts it on stage. `tobos --help` lists every command, and each takes `--json`.

## Get to the deck

- `tobos ls` lists the decks and templates the person can work on, by id. `tobos pull <id>` gets one; `tobos new "Title"` starts one and pulls it.
- A new deck starts from Tobos simple. The person's own templates, their house styles, are in `tobos ls`: start from one with `--from <id>`, and ask which when there are several.
- Then read the deck's `AGENTS.md`: it points to the loop, the format and the deck's slide master.
- The person's decks are in folders, which `tobos --help` lists the commands for.

Exit code 3 means this machine isn't connected to the person's account. Run `tobos login`: it prints an address, which the person opens on any device, logs in at (a first login signs them up, and accepts https://tobos.ai/terms) and approves this machine. Give it to them in one line, then, once they did, run `tobos login` again. In CI or a sandbox with no one to ask, `TOBOS_TOKEN` and `TOBOS_SERVER` stand in for the login.

## Follow the person

They decide what to make and how much of it you build: one scene at a time, or the whole deck at once. Build what they ask, at the size they ask, from what they have told you about the talk. When they ask how Tobos works or where to start, give them the tour, https://tobos.ai/tour, and nothing of your own: no explanation, no deck to try.

## Folders

- Look at the person's folders before you make or move a deck, and file it under a folder name they have already, as they wrote it, rather than a new one that means the same.
- File every deck you make: once it is made, move it into the folder it belongs in.
- Before you move more than a handful of decks, show the person the tree you propose, and make it once they say yes.
- A reorganisation is taken back by moving the decks back where they were: note where they were before you move them.
- A folder goes when it empties, by a move or a deck's deletion: there is no removing one. A folder with only archived decks in it isn't empty.

## What stays the person's

- **Exit code 5** is a plan's limit or an archived deck. Show the person the message as it is, which says what they can do, and wait for their answer. The deck stays in Tobos: a deck built elsewhere to upload later, media shrunk or hosted elsewhere to fit, or someone else's account would decide for them what is theirs to decide.
- **Archiving, opening again and deleting** a deck, and deleting a session's answers, are done by the person on the deck's page, in their own browser.
- **Who is on a deck, and its link,** are the person's, on the deck's page: they put people on it, change what each may do, take them off, and turn the link on or off there. You neither see nor change any of it: `tobos ls` tells you only what you may do on each deck and whose it is. Can edit builds it with their own agent, can present presents it with its notes and polls, and can view sees the slides; on a template, can edit and can use.
- **The URL `tobos open` prints** is the deck's page, where the person watches it, presents it and shares it; `--presenter` gives a presenter's link instead, which opens once, for whoever opens it first.

## The story

A deck's story is the talk as the speaker tells it, in paragraphs. What follows a mention of a scene, `[Title](scene:<id>)` or one of its beats, `[Title](scene:<id>/<beat>)`, up to the next mention, is that scene's: the presenter sees it as speaker notes. The server holds the story, not git: the person types in it on the deck's page, and you change it with `tobos story`.

- Read it again right before each change: the person may be typing.
- Change what the person asked, and keep the rest of their words as they are.
- An edit is anchored on exact text that occurs once in its paragraph. Exit code 4 means the paragraph changed meanwhile: anchor on it as the reply gives it, and try again.
- Set `TOBOS_AGENT` to your name (`claude`, `codex`), so the page shows what you wrote.
