<!-- A scene's beats, a dot each, to put one on stage. A long scene shows them a page at a time,
     the page of the beat on stage, with a chevron on the side where there are more. The beat on
     stage is a pill with its number, and the dot under the pointer shows its number, drawn over its
     neighbours so nothing moves. The deck's page has it (its outline, under the stage), and a share
     link's contents (code/present/src/viewer/contents.ts), turned over on the dark list: its
     colours are the ink's, and the paper's, which .on-ink turns over. -->
<script module lang="ts">
  /** The dots on a page. A scene with up to ALL beats shows them all, without chevrons. */
  export const PAGE = 8;
  export const ALL = 10;
  /**
   * In a list, the width a dot takes with the gap after it, and the two chevrons a paged strip
   * adds, with theirs: what a row gains when the strip shows fewer dots a page.
   */
  export const DOT = 8;
  export const CHEVRONS = 26;
</script>

<script lang="ts">
  import type { Attachment } from 'svelte/attachments';

  let {
    beats,
    on,
    current,
    title,
    label,
    show,
    large = false,
    perPage,
    pointed = -1,
    summary,
    attach,
  }: {
    beats: string[];
    /** Whether the scene is on stage. */
    on: boolean;
    /** The beat on stage, if the scene is. */
    current: string | null;
    title: (beat: string, index: number) => string;
    label: (beat: string, index: number) => string;
    show: (beat: string) => void;
    /** Under the stage, rather than in a list of scenes. */
    large?: boolean;
    /**
     * The dots it shows at once, where the row has little room: more beats than that go a page at
     * a time. Unset, a scene with up to ALL beats shows them all, a longer one PAGE a page.
     */
    perPage?: number;
    /** A beat shown elsewhere (a preview stepped by the keys): its number over its dot, as hovered. */
    pointed?: number;
    /** What the strip is, to a screen reader: "5 steps". */
    summary?: string;
    /** What the page adds to the strip (the deck page's letGo). */
    attach?: Attachment<HTMLElement>;
  } = $props();

  const paged = $derived(beats.length > (perPage ?? ALL));
  const page = $derived(perPage ?? PAGE);
  const at = $derived(on && current ? beats.indexOf(current) : -1);
  // Pages are `page` apart, and the last ends with the scene; the page of a beat pointed at, else
  // of the one on stage.
  const start = $derived(
    paged
      ? Math.max(
          0,
          Math.min(
            Math.floor(Math.max(pointed >= 0 ? pointed : at, 0) / page) * page,
            beats.length - page,
          ),
        )
      : 0,
  );
  const shown = $derived(paged ? beats.slice(start, start + page) : beats);
  // The pill is as wide as the scene's highest number, so the strip doesn't move while stepping.
  const digits = $derived(String(beats.length).length);
  const pill = $derived(large ? Math.max(17, 8 + digits * 6.5) : Math.max(15, 7 + digits * 6));
  const noop: Attachment<HTMLElement> = () => {};
</script>

{#snippet chevron(side: 'left' | 'right', hidden: boolean)}
  <svg
    class="chevron"
    class:hidden
    width={large ? 12 : 10}
    height={large ? 12 : 10}
    viewBox="0 0 24 24"
    aria-hidden="true"><path d={side === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg
  >
{/snippet}

<!-- Where there are no more, a chevron keeps its place, so the dots don't move as pages turn. -->
<span
  {@attach attach ?? noop}
  class="strip"
  class:large
  role={summary ? 'group' : undefined}
  aria-label={summary}
>
  {#if paged}{@render chevron('left', start === 0)}{/if}
  {#each shown as beat, j (beat)}
    {@const index = start + j}
    {@const here = index === at}
    <!-- One button whether on stage or not: a beat chosen by keyboard keeps the focus. -->
    <button
      type="button"
      data-beat={index}
      title={title(beat, index)}
      aria-label={label(beat, index)}
      aria-current={here ? 'step' : undefined}
      onclick={() => show(beat)}
      style:min-width={here ? `${pill}px` : undefined}
      class={here ? 'here' : 'dot'}
      class:on
      class:pointed={!here && index === pointed}
      >{#if here}{index + 1}{:else}<span aria-hidden="true">{index + 1}</span>{/if}</button
    >
  {/each}
  {#if paged}{@render chevron('right', start + page >= beats.length)}{/if}
</span>

<style>
  .strip {
    /* The paper under the ink: white, or the dark ground where .on-ink turns the ink white. */
    --paper: #fff;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: 3px;
  }
  :global(.on-ink) .strip {
    --paper: var(--ground);
  }
  .large {
    gap: var(--s1);
  }
  .chevron {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    color: var(--ink-3);
  }
  .chevron.hidden {
    visibility: hidden;
  }
  button {
    margin: 0;
    padding: 0;
    border: 0;
    cursor: pointer;
    appearance: none;
  }
  /* The beat on stage: a pill with its number, in its place. */
  .here {
    height: 15px;
    padding: 0 var(--s1);
    border-radius: 999px;
    background: var(--ink);
    color: var(--paper);
    font: 500 9px / 15px var(--mono);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  .large.strip .here {
    height: 17px;
    font-size: 10px;
    line-height: 17px;
  }
  /* A dot; its target spans half the gap each side, and above and below it. */
  .dot {
    position: relative;
    flex: none;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--ink) 15%, transparent);
  }
  .dot.on {
    background: color-mix(in srgb, var(--ink) 35%, transparent);
  }
  .large .dot {
    width: 6px;
    height: 6px;
  }
  .large .dot.on {
    background: color-mix(in srgb, var(--ink) 30%, transparent);
  }
  .dot::before {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--s2)) -1.5px;
  }
  /* Its number, over it when pointed at, ringed in the paper: it covers its neighbours a moment. */
  .dot span {
    position: absolute;
    z-index: 10;
    top: 50%;
    left: 50%;
    box-sizing: border-box;
    height: 17px;
    min-width: 17px;
    padding: 0 var(--s1);
    border-radius: 999px;
    background: var(--ink);
    box-shadow: 0 0 0 2px var(--paper);
    color: var(--paper);
    font: 500 9.5px / 17px var(--mono);
    font-variant-numeric: tabular-nums;
    text-align: center;
    pointer-events: none;
    opacity: 0;
    translate: -50% -50%;
    scale: 0.4;
    transition:
      scale 0.1s ease-out,
      opacity 0.1s ease-out;
  }
  .dot:focus-visible span,
  .dot.pointed span {
    opacity: 1;
    scale: 1;
  }
  @media (hover: hover) {
    .dot:hover span {
      opacity: 1;
      scale: 1;
    }
  }
</style>
