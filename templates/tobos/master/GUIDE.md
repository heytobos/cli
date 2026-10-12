# The deck's master: the guide for agents

This folder is the deck's slide master, copied from Tobos standard when the deck was made. It is the deck's own code: change it when the deck needs something it doesn't have, and write the change down here. Scenes import its layouts and components from `../master/index.ts`. Everything is sized for the 1920×1080 stage, in stage pixels.

## Rules the check enforces

They are in `master.json`; `tobos check` and every push enforce them.

- **Nothing smaller than 28px.** `tobos check` rejects a `font-size` below 28px in a scene. It's the smallest size readable from the back of a lecture hall.

## Rules the check can't enforce, which we hold you to

- **One focal motion at a time.** If two things move at once, nobody knows where to look.
- **Motion carries meaning.** Something moves because it arrives, leaves, changes or is the point now. Nothing moves for decoration.
- **Continuity over cuts.** Something that stays on screen across beats moves to its new place (GSAP Flip); it doesn't fade out and back in.
- **Nothing loops while the presenter talks.**
- **The story carries the scene.** A content scene has a headline only when it says something (a claim, a question), never a label like "Overview".
- **Navy is the accent, and highlight red means "look here now"**: one thing at a time.

## Layouts

Every scene renders exactly one layout as its root.

| Layout    | Use it for                                  | Props                                                                                                                                                                                                                       | Regions                                    |
| --------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `Title`   | the deck's first scene                      | `title` (default: the deck's title), `subtitle`, `kicker`                                                                                                                                                                   | kicker, title, subtitle                    |
| `Section` | a divider between chapters                  | `title` (default: the chapter's title), `kicker` (default: "Part n"), `subtitle`, `tone`: `dark` (default), `paper`, `soft`                                                                                                 | kicker, title, subtitle                    |
| `Content` | most scenes                                 | `headline`, `wayfinder` (default `true`: the chapter's title; a string overrides it; `false` hides it), `split`: `half`, `wide`, `narrow`; `align`: `center` (default) or `top`, for a long list or code under the headline | headline, main (children), aside (snippet) |
| `Agenda`  | the parts of the talk                       | `title` (default "Today"), `current` (chapter ID to highlight; default: the current chapter; `null` for none), `skip` (chapter IDs to leave out)                                                                            | items: each `data-part="item"`             |
| `Blank`   | full-bleed images, diagrams, bespoke scenes | `tone`                                                                                                                                                                                                                      | main (children)                            |

The main region of `Content` is `position: relative`, so a scene can place things absolutely inside it. Every region carries `data-region`, so a beat can target it: `q('[data-region=aside]')`.

```svelte
<script module lang="ts">
  import type { Beat } from '@tobos/present';
  import { motion } from '../master/index.ts';

  export const beats: Beat[] = [
    { id: 'claim' },
    {
      id: 'number',
      enter: (tl, q) => tl.from(q('[data-region=aside]'), { ...motion.enter, opacity: 0, x: 48 }),
    },
  ];
</script>

<script lang="ts">
  import { Content, Stat } from '../master/index.ts';
</script>

<Content headline="A model never sees words, only numbers">
  <p>Before anything else happens, the text is cut into tokens.</p>
  {#snippet aside()}
    <Stat value="100,277" label="tokens in the vocabulary" />
  {/snippet}
</Content>
```

## Components

| Component   | Props                                                                        | Parts for beats                        |
| ----------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| `Quote`     | `text`, `by`                                                                 | `text`, `by`                           |
| `Stat`      | `value` (a string, formatted), `label`, `tone`: `accent`, `ink`, `highlight` | `value`, `label`                       |
| `Chip`      | `tone`: `soft`, `outline`, `ink`, `highlight`; children                      | `chip`                                 |
| `Code`      | `code`, `focus` (line numbers to keep bright; the rest dims)                 | `code`; each line is `[data-line="n"]` |
| `Wayfinder` | `label` (default: the chapter's title)                                       | `wayfinder`                            |

Components only render; scenes do the animating. Target parts with `q('[data-part=value]')`.

To walk through code, drive `focus` from the beat rather than animating it:

```svelte
<script lang="ts">
  let { index }: { index: number } = $props();
</script>

<Code {code} focus={[[1], [2, 3], [4]][index]} />
```

## Motion

Use the presets, so every scene moves with one feel:

```ts
import { motion, focus } from '../master/index.ts';

tl.from(q('[data-part=item]'), { ...motion.enter, opacity: 0, y: 24, stagger: motion.stagger });
tl.to(q('.old'), { ...motion.exit, opacity: focus.dim });
```

| Preset            | Duration | Ease                      | For                            |
| ----------------- | -------- | ------------------------- | ------------------------------ |
| `motion.enter`    | 0.6 s    | `tobos`, tobos.ai's curve | things arriving                |
| `motion.exit`     | 0.3 s    | `power2.in`               | things leaving                 |
| `motion.move`     | 0.6 s    | `power2.inOut`            | things changing place          |
| `motion.emphasis` | 0.3 s    | `power1.inOut`            | a short emphasis, no overshoot |
| `motion.stagger`  | 0.08 s   |                           | between items in a row         |

`focus.dim` (0.25) and `focus.muted` (0.55) are the opacities for what isn't the point right now.

## Video

A video is motion like any other: it plays in a beat, with `playVideo` from `@tobos/present` (FORMAT.md, "Video"), never `autoplay` or `loop`. While it plays it is the one focal motion, so start a caption with it (`'<'`) rather than animating beside it. Give it a region to fill, `Blank`'s or `Content`'s main, and `object-fit: contain` so nothing is cropped:

```svelte
<script module lang="ts">
  import { playVideo, type Beat } from '@tobos/present';

  export const beats: Beat[] = [
    { id: 'cow' },
    { id: 'turn', enter: (tl, q) => playVideo(tl, q('video')) },
  ];
</script>

<script lang="ts">
  import { media } from '@tobos/present';
  import { Blank } from '../master/index.ts';
</script>

<Blank>
  <video src={media('cow-turns.webm')} muted playsinline preload="auto"></video>
</Blank>

<style>
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
```

## Tokens

CSS variables, for scenes that draw their own things:

- Colour: `--stage-paper`, `--stage-ink`, `--stage-muted`, `--stage-rule`, `--stage-accent` (navy), `--stage-dark`, `--stage-highlight` (red); `--stage-soft`, the accent's tint, for surfaces only.
- Type: `--stage-font-text` (Hanken Grotesk), `--stage-font-label` (Geist Mono; capitals, tracked 0.08em), `--stage-font-mono` (Geist Mono). Sizes: `--stage-size-label` 28, `-code` 32, `-body` 40, `-lead` 52, `-title` 64, `-section` 96, `-display` 144.
- Grid: `--stage-margin-x` 112, `--stage-margin-top` 96, `--stage-margin-bottom` 96, 12 columns, `--stage-gutter` 32. `import { grid, column } from '../master/index.ts'` gives the same numbers in TypeScript. Press L in the viewer to see the guides.

## The source

This guide is what most scenes need. For the rest (the exact box of a region, what a layout does with a prop), read the source next to it: `layouts/` and `components/` hold the Svelte files, `tokens.css` the variables and fonts, `grid.ts` and `motion.ts` the numbers. The master's own files (its fonts, a logo) are in `media/master/`.
