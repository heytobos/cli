# The Tobos Present deck format

A deck is a git repository. Tobos hosts it, checks every push, compiles it, and shows it in a browser. Nothing in a deck runs at build time: there is no build configuration, and no step you could add one to. Everything a deck does, it does in the viewer's browser.

```
deck.json          the deck's structure: title, chapters and scenes
scenes/<id>.svelte one file per scene
master/            the deck's slide master: layouts, components, tokens.css, master.json, GUIDE.md
data/              precomputed data (JSON), written on your machine, committed
lib/               shared code and components for this deck (.svelte, .ts, .js)
media/             images, video, audio: uploaded by `tobos push`, never committed
media.json         what is in media/, by content hash (written by `tobos check` and `tobos push`)
scripts/           your scripts that compute data/ and media/ (committed, never run by Tobos)
sources/           originals the scripts read: full-size scans, raw data (never committed)
AGENTS.md          points the agent that builds the deck to this file and the master's guide
.tobos/            this file, as the server has it now: written by `tobos clone` and `tobos pull`, never committed
```

Besides `media/`, a deck's files may take 100 MB together and number at most 10,000, each at most 20 MB. The server rejects a push that goes over, in any of its commits for the 20 MB.

## Working on a deck

You work in a clone of the deck, from `tobos clone <id>` or `tobos new`, and every push is live: the server runs the same check as `tobos check`, refuses a push that fails it with the check's messages, and every open preview follows within a second, so the person watches the deck take shape.

1. Change `deck.json`, the scenes and whatever else the step needs.
2. `tobos check` checks the deck offline, in about a second: fix every error it reports. `--types` adds TypeScript's view in a few seconds, worth it before a push that changed code.
3. `tobos render <scene>/<beat>` pushes what changed and writes a PNG of that beat; `--film` writes frames through its animation. Look at each one.
4. `tobos push -m "what changed"` uploads new media, commits and pushes. `render` and `open` push the same way when the working copy has changed, and `-m` names that push too.

A step is done when every beat it changed has been rendered and looked at. Plain `git push` to `main` works too, checked the same way, for a change that adds no media, since only `tobos push` uploads it. The server takes pushes to `main` only.

## deck.json

```json
{
  "title": "Data Visualisation, lecture 1",
  "chapters": [
    {
      "id": "opening",
      "title": "Opening",
      "scenes": [
        { "id": "title", "title": "Title" },
        { "id": "same-problem", "title": "Same problem" }
      ]
    }
  ],
  "dependencies": { "d3": "7.9.0" }
}
```

- `title`: the deck's title.
- `chapters`: at least one. Each has an `id` and a `title`, and at least one scene. A deck has at most 500 scenes in all; a longer one is several decks.
- `scenes[]`: an `id` and a `title`. The scene's code is in `scenes/<id>.svelte`.
- `dependencies` (optional): npm packages the scenes import, with exact versions. Svelte and GSAP come with Tobos and aren't listed.

IDs are lowercase letters, digits and dashes, starting with a letter: `same-problem`, `q2`. Scene IDs are unique across the whole deck, chapter IDs across the chapters. Titles, of the deck, a chapter or a scene, are at most 200 characters. Tobos reads these keys and no others; any others stay in the file.

## Scenes and beats

A presentation is a sequence of **beats**. One click advances one beat. A scene is one Svelte 5 file that declares its beats, in order, in its module script, and animates into each one:

```svelte
<script module lang="ts">
  import type { Beat } from '@tobos/present';

  export const beats: Beat[] = [
    { id: 'ask' },
    {
      id: 'answer',
      enter: (tl, q) => tl.from(q('[data-part=answer]'), { opacity: 0, y: 24, duration: 0.6 }),
    },
  ];
</script>

<script lang="ts">
  import { Content } from '../master/index.ts';
</script>

<Content>
  <h2>What is intelligence?</h2>
  <p data-part="answer">Nobody agreed in 1955 either.</p>
</Content>
```

- `Content` is a layout from the deck's master (see [The master](#the-master)). The templates Tobos comes with all have `Title` and `Content`, which the examples here use; `master/GUIDE.md` says what the deck's own master has, and with which props.

- `beats` is exported as an array literal, and every `id` is a string literal. Tobos reads the beats without running your code, so computed lists and IDs are rejected.
- A scene has at most 100 beats. One that needs more is several scenes.
- `enter(tl, q)` adds the animation into the beat to `tl`, the scene's GSAP timeline. `q(selector)` finds elements inside this scene only. A beat without `enter` changes nothing on screen (useful as the first beat of a scene whose layout is already complete).
- The engine builds one timeline per scene: every beat's `enter`, followed by a label with the beat's ID. Animations that hide something at the start use `tl.from(...)`, so the hidden state is the timeline's start.
- The scene's first beat is its entrance: stepping into a scene plays it.

### What the engine guarantees

- **What is on screen depends only on the position.** Stepping forward plays the beat's animation. Going back, jumping, or reloading lands on the beat's end state instantly. A click while a beat is still playing finishes it at once and starts the next.
- **Scenes are mounted ahead**, out of sight, and their media preloads, so stepping into a scene never blinks.
- **The stage is 1920×1080**, scaled to the screen. Write all sizes in stage pixels.

So everything that moves belongs in a beat's `enter`, video and sound too (see [Video](#video) and [Sound](#sound)), and a scene keeps only state the position recreates. An animation started in `onMount` or a timer runs on its own clock, and the check warns about both.

### Props

A scene receives two props, if it wants them: `beat` (the current beat's ID) and `index` (its position in the scene, from 0). Use them for things that are not animations, such as which line of code is highlighted. They say which beat is current, not whether it is playing or was jumped to, nor whether the scene is waiting out of sight: whatever depends on that belongs on the timeline, where the engine handles it.

### Where the scene is: `useDeck()`

`useDeck()` from `@tobos/present`, called in a component's script, returns the deck's `title`, its `chapters` (each with `id`, `title` and `scenes`, each with `id` and `title`), and the current `chapter` and `scene` (`id` and `title`). Layouts use it for wayfinders and agendas; a scene may too:

```svelte
<script lang="ts">
  import { useDeck } from '@tobos/present';
  const { chapter } = useDeck();
</script>

<p>Part: {chapter.title}</p>
```

### Loading ahead: `preload()`

A scene's module script may export an async `preload()`. The engine calls it once, when it loads the scene to mount it ahead, and doesn't wait for it; a failure is logged. Use it for what the scene's markup doesn't already load, such as an image a later beat swaps in. Media the markup shows (`<img>`, `<video preload="auto">`, `<audio preload="auto">`) already loads while the scene is mounted ahead.

```svelte
<script module lang="ts">
  import { media, type Beat } from '@tobos/present';

  export const beats: Beat[] = [{ id: 'cow' }, { id: 'close-up' }];

  export async function preload() {
    const later = new Image();
    later.src = media('cow-close-up.jpg');
    await later.decode();
  }
</script>
```

### Positions

The URL names a position as `#scene/beat`. `#scene/2` is the scene's third beat, `#scene` its first.

## Imports

A scene, and anything in `master/` and `lib/`, may import:

| Import                      | What it is                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `svelte`, `svelte/*`        | Svelte 5                                                                                                                                            |
| `gsap`, `gsap/*`            | GSAP 3, all plugins                                                                                                                                 |
| `@tobos/present`            | the engine's API for scenes: `Beat`, `media()`, `playVideo()`, `playAudio()`, `useDeck()`, `Activity`, `useResponses()`, `useJoin()`, `<JoinCode/>` |
| `./…`, `../…`               | files inside the deck: `.svelte`, `.ts`, `.js`, `.json`; the master is `../master/index.ts` from a scene                                            |
| a package in `dependencies` | any npm package that runs in a browser                                                                                                              |

Nothing else: no Node APIs, no URLs, no files outside the deck.

### npm packages

List a package in `dependencies`, then import it, or any path it exports:

```ts
import { scaleLinear } from 'd3';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import 'katex/dist/katex.min.css';
```

On push, the server fetches each package from npm (it never runs install scripts or package code) and bundles what the deck imports into ES modules for the browser, one copy of each package: `three` and `three/addons/…` share one three. Use packages that ship ES modules and run in a browser. One that needs Node (`fs`, `path`, …) is rejected with what it tried to import. A CommonJS package gives only its default export, so take its ES-module build (`lodash-es`, not `lodash`). Files a package loads next to its code, such as WebAssembly, aren't served.

- **A package's CSS**: import it for its effect, and the viewer links it, with the fonts and images it points to. Your deck's own CSS goes in `<style>` blocks: a `.css` file in the deck can't be imported.
- **Limits**: a deck's packages may take 200 MB installed on the server, and what the deck imports from them may bundle to 20 MB. A push over either is rejected, naming the largest packages or files.

## Data

Data that needs computing (model outputs, statistics, cut-outs) is computed on your machine by whatever script you like, and only its output is committed: JSON in `data/`, files in `media/`. Import JSON directly:

```ts
import tokens from '../data/tokens.json';
```

Keep those scripts in `scripts/`, so the next person can rerun them. `scripts/` may have its own `package.json` (or `requirements.txt`, anything): Tobos never installs or runs it, and nothing in it is compiled into the deck. Originals the scripts read (a 4000-pixel scan, a raw dataset) go in `sources/`, which `.gitignore` keeps out of git and `tobos push` never uploads; the scripts write stage-sized results into `media/` and `data/`. For example, `scripts/cut.mjs` reads `sources/proposal.png`, writes the cut-outs to `media/proposal/`, and their boxes to `data/proposal.json`.

## Media

Media stays out of git (`.gitignore` has `media/`). Put files in `media/`: `tobos check` and `tobos push` record them in `media.json`, and push uploads those a slide shows. In a scene:

```svelte
<script lang="ts">
  import { media } from '@tobos/present';
</script>

<img src={media('cow.jpg')} alt="A cow" />
```

- **A file is named by its path inside `media/`**, as a string literal, so Tobos can check it exists. When the names come from data, a template literal is checked as a pattern: ``media(`cow/${part}.png`)`` must match at least one file of `cow/*.png`.
- **`media()` is called by its own name**: imported from `@tobos/present`, from one of the deck's files that passes it on as `media` (`export { media } from '@tobos/present'`), or as `present.media('cow.jpg')` after `import * as present from '@tobos/present'`. Tobos reads each call to know which files a scene shows, and a share link gets only those (see [the share link](#the-share-link)), so it refuses `media()` under another name (`import { media as m }`), passed on as a value (`names.map(media)`) or loaded with `import()`. A `media` of the deck's own, or a parameter by that name, isn't the engine's, and is left alone.
- **Size media for the stage**: a 4000-pixel scan shown at 800 pixels costs memory on every phone that opens the deck. `tobos push` notes files over 25 MB.
- **Only media on a slide counts toward the plan**: the files the `media()` calls of the scenes `deck.json` lists name, with everything they import, the master's, and the fonts `tokens.css` links. The master's own files, under `media/master/`, count as on a slide.
- **A file no slide shows** draws the check's warning, a file deleted from `media/` among them (its entry stays in `media.json`, since a fresh clone has no `media/`). The server keeps such a file for 7 days, and may delete it after that: to show it then, push it from `media/` again, or drop it on the deck's page. A scene that names a file the server no longer has is refused until it is there again.

## Video

A video plays as part of a beat: `playVideo(tl, q('video'))` in the beat's `enter`. The scene's timeline is the clock and the video follows it, so a video keeps the engine's guarantees like any animation.

```svelte
<script module lang="ts">
  import { playVideo, type Beat } from '@tobos/present';

  export const beats: Beat[] = [
    { id: 'cow' },
    {
      id: 'turn',
      enter: (tl, q) => {
        playVideo(tl, q('video'));
        tl.from(q('[data-part=caption]'), { opacity: 0, duration: 0.6 }, '<');
      },
    },
  ];
</script>

<script lang="ts">
  import { media } from '@tobos/present';
</script>

<video src={media('cow-turns.webm')} muted playsinline preload="auto"></video>
<p data-part="caption">She knows she's being watched.</p>
```

- **Stepping forward plays it** in real time. Going back, jumping or reloading shows the frame for that position at once. A click while it plays lands on its last frame and starts the next beat.
- **Before its beat it shows the clip's first frame**, also while the scene waits mounted ahead; nothing plays out of sight. Above, `cow` shows the first frame and `turn` plays the video.
- **The presenter's view, `tobos render` and PDF show the frame the beat ends on**; `tobos render --film` shows frames through it.
- **Options**, `playVideo(tl, target, { from, to, rate, position, sound })`: the clip's start and end in seconds of the video (default: all of it), its speed (default `1`), and where in the beat it starts, as GSAP's position parameter (default: after what the beat has added so far; `'<'` after it means "at the same time as the video"). To play a video over several beats, give each beat a clip: `{ to: 4 }`, then `{ from: 4 }`. `sound: true` plays the video's own sound with it (see [Sound](#sound)); without it, a video is muted.
- **The timeline starts and stops the video.** Write `muted playsinline preload="auto"`, and no `autoplay` or `loop`; don't call `play()` yourself. `playVideo` makes the element inline and preloading if you forget, and muted unless `sound` is set.
- **The engine builds a scene's timeline once its videos know their length**, so `to` defaults to the video's end. A video that can't load is skipped after a few seconds; pass `to` for one that loads late.
- **Encode for jumping:** WebM (VP9) or MP4 (H.264), at the size shown, with a keyframe at least every two seconds (`ffmpeg … -g 60` at 30 fps). A jump decodes from the keyframe before it.

## Sound

A sound plays as part of a beat, as a video does: `playAudio(tl, q('audio'))` in the beat's `enter`. A click or key press steps into the beat, and the sound plays.

```svelte
<script module lang="ts">
  import { playAudio, type Beat } from '@tobos/present';

  export const beats: Beat[] = [
    { id: 'bird' },
    {
      id: 'song',
      enter: (tl, q) => {
        playAudio(tl, q('audio'));
        tl.from(q('[data-part=caption]'), { opacity: 0, duration: 0.6 }, '<');
      },
    },
  ];
</script>

<script lang="ts">
  import { media } from '@tobos/present';
</script>

<audio src={media('blackbird.m4a')} preload="auto"></audio>
<p data-part="caption">A blackbird, at dawn.</p>
```

- **Stepping forward plays it** in real time, and the beat lasts as long as the clip. A click while it plays stops it and starts the next beat. Going back, jumping or reloading is silent, and so is a scene waiting mounted ahead.
- **Options**, `playAudio(tl, target, { from, to, rate, position })`, as for a video.
- **Playing on through beats**: `playAudio(tl, q('audio'), { until: 'outro' })` starts the sound on this beat and lets it play on, while the presenter clicks on, or back, through the beats before `outro`. It fades out over a second when `outro`, or a beat before its own, is shown, or the scene is left; `fade` sets the seconds, `0` stops it at once (iPhone and iPad always stop it at once). The beat it starts in doesn't wait for it, so `to` and `position` don't apply: it plays from `from` to its end, or until then. Only a step forward onto its beat starts it: a jump or a reload into the middle of the range is silent. `until` is a string literal naming a later beat of the same scene; the check refuses any other. A range ends with its scene at the latest.
- **The timeline starts and stops the sound.** Write `<audio src={media(…)} preload="auto">`, without `controls`, `autoplay` or `loop`, and don't call `play()` yourself. Nothing of it shows on stage: where the room needs to know what it hears, say so on the slide, which is also all a PDF shows.
- **A video's own sound**: `playVideo(tl, q('video'), { sound: true })`, by the same rules.
- **One window is heard**: the one someone clicks through, a share link's among them, and, while presenting, the audience window, which plays the presenter's clicks aloud. The presenter's view, other windows that follow the show, `tobos render` and PDFs are silent, and so is a deck with its animations turned off.
- **A browser lets a page make sound once someone has clicked or pressed a key in it.** Presenting, the click that makes the audience window fullscreen does it. Where a browser refuses all the same, the window says "Click for sound": a click there plays on with sound. A sound waits meanwhile, and a video plays on muted.
- **Encode for the room:** AAC (`.m4a`) or MP3 plays in every browser. Speech at 64–96 kbps mono and music at 128–192 kbps stereo take 0.5 to 1.5 MB a minute, so half an hour of speech stays under the 25 MB `tobos push` notes. Opus (`.webm`) is smaller still, but older Safari doesn't play it. WAV, AIFF and FLAC are five to ten times the size for nothing a room hears, and `tobos push` notes those over 1 MB: `ffmpeg -i media/song.wav -c:a aac -b:a 128k media/song.m4a`.

## Polls on phones

A scene may ask the room a poll, which people answer on their phones: **multiple choice** (`kind: 'choice'`) or **open text** (`kind: 'text'`). A deck has one **join code**, six digits, for good; its link (`tobosusercontent.com/482913`) opens whatever poll the presenter is on, so people scan it once per lecture. `<JoinCode size={480} />` shows it: a QR code, with the link under it in the scene's font. To lay it out another way, `useJoin()` gives its parts: `code` (`482913`), `link` (as people type it, `tobosusercontent.com/482913`), `url` (the full URL the QR code holds) and `qr` (the QR code, black on white, as an image's address: `<img src={join.qr} alt="" />`). It is undefined while the deck has no poll, and on a share link, where `<JoinCode/>` shows nothing at all.

A scene declares at most one poll, as `activity` in its module script, beside its beats:

```svelte
<script module lang="ts">
  import type { Activity, Beat } from '@tobos/present';

  export const beats: Beat[] = [{ id: 'ask' }, { id: 'result' }];
  export const activity: Activity = {
    id: 'used-llm-api',
    kind: 'choice',
    prompt: 'Have you called an LLM API yourself?',
    options: ['Never', 'Once or twice', 'Regularly'],
    reveals: 'result',
  };
</script>

<script lang="ts">
  import { useResponses } from '@tobos/present';
  import { Content } from '../master/index.ts';

  let { beat }: { beat: string } = $props();
  const responses = useResponses('used-llm-api');
</script>

<Content>
  <h2>Have you called an LLM API yourself?</h2>
  {#if beat === 'result'}
    {#each responses.counts as count, i (i)}<p>{count}</p>{/each}
  {/if}
</Content>
```

```ts
export const activity: Activity = {
  id: 'course-wishes',
  kind: 'text',
  prompt: 'Help us make this course great',
  fields: [
    { id: 'amazing', label: 'What would make this course amazing?', multiline: true },
    { id: 'worry', label: 'What worries you about it?', multiline: true, max: 500 },
  ],
};
```

- **When it is open.** While the deck is presented (its audience window is open) and the presenter is on the poll's scene, up to, not including, its `reveals` beat. Nothing else opens or closes one: no buttons, no timers. Moving to another scene closes it, and every phone moves on to the next scene's poll or waits. Ending the show closes everything.
- **`activity`** is `export const`, an object literal of string, number and boolean literals and arrays of them, read without running the scene, as beats are. Its `id` is lowercase letters, digits and dashes, unique across the deck: it names the poll's answers, so keep it when you reword the prompt.
- **Multiple choice**, `kind: 'choice'`: a `prompt` (up to 200 characters), 2 to 8 different `options` (up to 80 characters each), and optionally `reveals`, a later beat of its scene, which closes the poll and is where the scene shows the result.
- **Open text**, `kind: 'text'`: an optional `prompt` (up to 200 characters) and 1 to 5 `fields`, each with an `id` unique in the poll, a `label` (up to 200 characters), optionally `multiline: true`, and `max`, the characters it takes (500 unless set, at most 2000). Its answers are stored and never shown on stage, so it has no `reveals`.
- **On a phone** there is no account, name or cookie. A phone answers each poll once per show; a draft of an open-text answer survives a reload. A phone makes an id for the show when it first answers, and forgets it, with its drafts, when the next show starts or 3 hours after the page was last open.
- **Results**: `useResponses(id)` gives `joined` (the most phones that had the link open at once during this show, and never fewer than answered), `answered` (those that answered this poll), and for multiple choice `counts`, one number per option in the order declared (open text's is empty). They count from the start of the show, one class or one talk. A reload or a dropped connection carries the show on; it ends when the presenter ends it, or after an hour without the presenter. **New session** in the presenter's view starts a new show at once, so a rehearsal's or the last class's answers don't show. The audience and presenter windows get results as they come in, and so does the preview on the deck's page; `tobos render` and PDFs show zeros. An open-text poll's text never reaches the viewer, only how many answered.
- **Results are live data**, which the position can't recreate (like video): going back to a result beat shows the counts as they are now. Show them in the markup, from `useResponses`; a beat's `enter` can animate them in, but not their values. The engine fetches them for the scene, which still can't use the network.
- **Afterwards**, the deck's page keeps each show's answers, to read and to download as a CSV.

## The share link

The share link (turned on on the deck's page) shows the deck to anyone with the link, without an account, to click through and download as a PDF, one page per scene at its last beat; it always shows the latest push. The deck's members download the same PDF from the page, shared or not. A share never opens a room: a scene with a poll is left out of it, and a chapter left with no scene goes too. So a scene that shows the join code next to other content still works shared: `<JoinCode/>` draws nothing there, and `useJoin()` is undefined.

A share gets only what the scenes it shows use, and so does a member who may only view the deck: those scenes' code and everything it imports, the master's among it, the files their `media()` calls name, and the fonts `tokens.css` links. Nothing else of the deck reaches it. This goes by file: a scene that imports a component gets every file the component names; a pattern, every file it matches (``media(`${name}`)`` matches them all); a module that re-exports others (`lib/index.ts`), all of them. So import a poll's own components directly, not through such a module. A file Tobos doesn't see a scene use, such as a `media/<hash>` address written out, is missing on a share rather than shown.

## Checks

`tobos check` runs on your machine, and the server runs the same check on every push and rejects the push if it fails. It checks `deck.json`, that every scene compiles, the beats, the imports (each file a deck imports of its own is there, and exports every name imported from it), the media references, and the master's rules (`master/master.json`). `tobos check --json` prints one object per problem: `{ file, line, column, rule, message, severity }`. Errors stop a push; warnings don't, but each one is a reason the deck may misbehave on stage. `tobos check --types` adds TypeScript's errors (rule `types`): it installs svelte-check once into `~/.cache/tobos/` and links it in as `node_modules`, which git ignores; the push check doesn't run it. The server stops a check that takes more than a minute or a gigabyte of memory, and rejects the push with the rule `check`; any real deck checks in seconds.

| Rule                                                           | Severity         | What it catches                                                                                                                                                              |
| -------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deck-json`, `scenes`, `beats`, `activity`, `imports`, `media` | error            | the structure above                                                                                                                                                          |
| `svelte/…`                                                     | error or warning | the Svelte compiler's own errors and warnings                                                                                                                                |
| `master/min-font-size`                                         | error            | type below the master's floor, in `font-size`, the `font` shorthand, `style:font-size`, `rem` and GSAP's `fontSize` (`em` and `calc()` depend on context and aren't checked) |
| `master/layout-root`                                           | warning          | a scene whose root isn't one layout from the master                                                                                                                          |
| `network`                                                      | error            | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and media or CSS `url()` loaded from another site: the viewer blocks all of them                                      |
| `compile`                                                      | error            | a `.json` module that isn't valid JSON, or a module whose imports can't be read                                                                                              |
| `media`                                                        | warning          | files `media.json` lists that no slide shows, which the server keeps for 7 days (see [Media](#media))                                                                        |
| `media-json`                                                   | error            | `media.json` that isn't the record `tobos check` and `tobos push` keep: a name, its hash, size and type                                                                      |
| `master`                                                       | error            | `master/master.json` that isn't JSON, or a rule's value of the wrong kind: `minFontSize` a positive number, `layoutRoot` true or false                                       |
| `dependencies`                                                 | error            | on push only: a package in `deck.json`'s `dependencies` that npm can't supply or that won't bundle for the browser, or packages over the limits (npm packages, above)        |
| `motion/timer`                                                 | warning          | `setTimeout`, `setInterval`, `requestAnimationFrame`: they run on their own clock, which the position can't recreate                                                         |
| `motion/on-mount`                                              | warning          | GSAP animation started in `onMount`, which plays even when the scene is mounted ahead, out of sight                                                                          |
| `motion/loop`                                                  | warning          | `repeat: -1` and CSS animations that run for ever                                                                                                                            |

The viewer keeps a connection open to follow pushes, so a browser test that waits for the network to go idle never finishes; wait for the page's `load` event instead.

## The master

`master/` is the deck's slide master, and the deck's own code: a new deck gets a copy of a template's master, and from then on nothing outside the deck changes it.

```
master/index.ts       what scenes import: `import { Title, Content } from '../master/index.ts'`
master/layouts/       layouts: Svelte components that fill the 1920×1080 stage
master/components/    components scenes put inside a layout
master/tokens.css     colours, fonts, sizes, as CSS variables; the deck's one stylesheet
master/master.json    the rules the check enforces: {"rules": {"minFontSize": 28, "layoutRoot": true}}
master/GUIDE.md       how to use it, for agents: every layout, component and rule
media/master/         the master's own files: its fonts, a logo (media like any other)
```

- Change the master when the deck needs something it doesn't have, and write the change down in `master/GUIDE.md`.
- `tokens.css` is linked on every page that shows the deck. Its `url()`s name files in `media/`, relative to `master/`: `src: url(../media/master/fonts/brand.woff2)`. Nothing else in the deck may be a stylesheet; a component's own CSS goes in its `<style>` block.
- A file the master's components show, such as a logo, is media: `media('master/logo.svg')`.
- `master.json`'s rules apply to every scene. Both are optional: without them, nothing is checked beyond the format.

## Templates

A template is a deck people start from.

- `tobos new "Title"` starts a deck with a copy of Tobos simple's master: `master/`, the media in `media/master/`, and the `dependencies` the master imports. `--from <id>` copies another template's; `tobos decks` lists the person's own.
- `tobos new "Our brand" --template` makes a template: a copy of all of Tobos simple, or of `--from`, scenes and master.
- A copy is a copy: nothing refers back to the template, so changing it changes only the decks made from it afterwards. To bring a deck along, copy the master's files across.
- A template's scenes are its gallery, one per layout or component with sample content, shown on its page in Tobos. When you add or change a layout, add or change its scene too.
- A new deck gets the template's master but not its `lib/` or `scenes/`, so the master imports neither: it keeps to its own files and packages.
- Tobos simple (`50ca89b5-c668-465b-b72b-eb5da0b9b9ab`: Title, Agenda, Content with one box, Blank, and the grid's guides) and Tobos standard (`06b48295-7c5c-4e1f-90f5-a082d60941de`, the full house style) come with Tobos: anyone may look at them, clone them and start from them.
