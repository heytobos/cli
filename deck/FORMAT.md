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
AGENTS.md          instructions for the agent that builds the deck
```

## deck.json

```json
{
  "title": "Generative AI, lecture 1",
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
- `chapters`: at least one. Each has an `id` and a `title`, and at least one scene.
- `scenes[]`: an `id` and a `title`, and optionally a `note`: a line about the scene for the people working on the deck (a template's gallery shows it). The scene's code is in `scenes/<id>.svelte`.
- `dependencies` (optional): npm packages the scenes import, with exact versions. Svelte and GSAP come with Tobos and aren't listed.

IDs are lowercase letters, digits and dashes, starting with a letter: `same-problem`, `q2`. Scene IDs are unique across the whole deck, chapter IDs across the chapters.

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

<Content headline="What is intelligence?">
  <p data-part="answer">Nobody agreed in 1955 either.</p>
</Content>
```

- `beats` is exported as an array literal, and every `id` is a string literal. Tobos reads the beats without running your code, so computed lists and IDs are rejected.
- `enter(tl, q)` adds the animation into the beat to `tl`, the scene's GSAP timeline. `q(selector)` finds elements inside this scene only. A beat without `enter` changes nothing on screen (useful as the first beat of a scene whose layout is already complete).
- The engine builds one timeline per scene: every beat's `enter`, followed by a label with the beat's ID. Animations that hide something at the start use `tl.from(...)`, so the hidden state is the timeline's start.
- The scene's first beat is its entrance: stepping into a scene plays it.

### What the engine guarantees

- **What is on screen depends only on the position.** Stepping forward plays the beat's animation. Going back, jumping, or reloading lands on the beat's end state instantly. A click while a beat is still playing finishes it at once and starts the next.
- **Scenes are mounted ahead**, out of sight, and their media preloads, so stepping into a scene never blinks.
- **The stage is 1920×1080**, scaled to the screen. Write all sizes in stage pixels.

So: don't animate in `onMount`, don't start timers, and don't keep state that the position can't recreate. Anything that moves belongs in a beat's `enter`, video too (see [Video](#video)).

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

A scene's module script may export an async `preload()`. The engine calls it once, when it loads the scene to mount it ahead, and doesn't wait for it; a failure is logged. Use it for what the scene's markup doesn't already load, such as an image a later beat swaps in. Media the markup shows (`<img>`, `<video preload="auto">`) already loads while the scene is mounted ahead.

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

| Import                      | What it is                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------- |
| `svelte`, `svelte/*`        | Svelte 5                                                                                                 |
| `gsap`, `gsap/*`            | GSAP 3, all plugins                                                                                      |
| `@tobos/present`            | the engine's API for scenes: `Beat`, `media()`, `playVideo()`, `useDeck()`                               |
| `./…`, `../…`               | files inside the deck: `.svelte`, `.ts`, `.js`, `.json`; the master is `../master/index.ts` from a scene |
| a package in `dependencies` | any npm package that runs in a browser                                                                   |

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

Media never goes into git. Put files in `media/`; `tobos push` uploads the ones the server doesn't have yet and records them in `media.json`. In a scene:

```svelte
<script lang="ts">
  import { media } from '@tobos/present';
</script>

<img src={media('cow.jpg')} alt="A cow" />
```

The name is the path inside `media/`, as a string literal, so Tobos can check it exists. When the names come from data, write a template literal: ``media(`cow/${part}.png`)`` is checked as the pattern `cow/*.png`, which must match at least one file. `tobos check` and `tobos push` record new files in `media.json`; push uploads them. Size media for the stage, not larger: a 4000-pixel scan shown at 800 pixels costs memory on every phone that opens the deck, and `tobos push` warns about files over 25 MB.

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
- **Options**, `playVideo(tl, target, { from, to, rate, position })`: the clip's start and end in seconds of the video (default: all of it), its speed (default `1`), and where in the beat it starts, as GSAP's position parameter (default: after what the beat has added so far; `'<'` after it means "at the same time as the video"). To play a video over several beats, give each beat a clip: `{ to: 4 }`, then `{ from: 4 }`.
- **The timeline starts and stops the video.** Write `muted playsinline preload="auto"`, and no `autoplay` or `loop`; don't call `play()` yourself. `playVideo` makes the element muted, inline and preloading if you forget. Video is silent for now.
- **The engine builds a scene's timeline once its videos know their length**, so `to` defaults to the video's end. A video that can't load is skipped after a few seconds; pass `to` for one that loads late.
- **Encode for jumping:** WebM (VP9) or MP4 (H.264), at the size shown, with a keyframe at least every two seconds (`ffmpeg … -g 60` at 30 fps). A jump decodes from the keyframe before it.

## Checks

`tobos check` runs on your machine, and the server runs the same check on every push and rejects the push if it fails. It checks `deck.json`, that every scene compiles, the beats, the imports, the media references, and the master's rules (`master/master.json`). `tobos check --json` prints one object per problem: `{ file, line, column, rule, message, severity }`. Errors stop a push; warnings don't, but each one is a reason the deck may misbehave on stage. `tobos check --types` adds TypeScript's errors (rule `types`): it installs svelte-check once into `~/.cache/tobos/` and links it in as `node_modules`, which git ignores; the push check doesn't run it.

| Rule                                               | Severity         | What it catches                                                                                                                                                              |
| -------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deck-json`, `scenes`, `beats`, `imports`, `media` | error            | the structure above                                                                                                                                                          |
| `svelte/…`                                         | error or warning | the Svelte compiler's own errors and warnings                                                                                                                                |
| `master/min-font-size`                             | error            | type below the master's floor, in `font-size`, the `font` shorthand, `style:font-size`, `rem` and GSAP's `fontSize` (`em` and `calc()` depend on context and aren't checked) |
| `master/layout-root`                               | warning          | a scene whose root isn't one layout from the master                                                                                                                          |
| `network`                                          | error            | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and media or CSS `url()` loaded from another site: the viewer blocks all of them                                      |
| `motion/timer`                                     | warning          | `setTimeout`, `setInterval`, `requestAnimationFrame`: they run on their own clock, which the position can't recreate                                                         |
| `motion/on-mount`                                  | warning          | GSAP animation started in `onMount`, which plays even when the scene is mounted ahead, out of sight                                                                          |
| `motion/loop`                                      | warning          | `repeat: -1` and CSS animations that run for ever                                                                                                                            |

The viewer keeps a connection open to follow pushes, so a browser test that waits for the network to go idle never finishes; wait for the page's `load` event instead.

## The master

`master/` is the deck's slide master, and the deck's own code: a new deck gets a copy of a template's master, and from then on nothing outside the deck changes it.

```
master/index.ts       what scenes import: `import { Content, Stat } from '../master/index.ts'`
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

A template is a deck people start from. Its scenes show its master off, one per layout or component, with a `note` in deck.json saying what each is for; its page on Tobos shows them as a gallery.

- `tobos new "Title"` starts a deck with a copy of Tobos standard's master. `--from account/template` copies another template's: `master/` and the media in `media/master/`.
- `tobos new "Our brand" --template` makes a template: a copy of all of Tobos standard (or of `--from`), showcase and master.
- A copy is a copy. Changing a template changes only the decks made from it afterwards; to bring a deck along, copy the master's files across.
- Tobos standard is the template every account has, `tobos/standard`: anyone may look at it, clone it and start from it.
