<!--
  A divider between parts of the talk. Regions: kicker, title, subtitle.
  Title and kicker default to the current chapter and its number.
-->
<script lang="ts">
  import { useDeck } from '@tobos/present';
  import Frame from '../components/Frame.svelte';

  let {
    title,
    subtitle,
    kicker,
    tone = 'dark',
  }: {
    title?: string;
    subtitle?: string;
    kicker?: string;
    tone?: 'dark' | 'paper' | 'soft';
  } = $props();
  const deck = useDeck();
  const number = $derived(deck ? deck.chapters.findIndex((c) => c.id === deck.chapter.id) + 1 : 0);
  const label = $derived(kicker ?? (number ? `Part ${number}` : ''));
</script>

<Frame layout="section" {tone}>
  <div class="section-layout">
    <div class="kicker" data-region="kicker">
      {#if label}<span>{label}</span>{/if}
    </div>
    <h1 data-region="title">{title ?? deck?.chapter.title}</h1>
    {#if subtitle}<p class="subtitle" data-region="subtitle">{subtitle}</p>{/if}
  </div>
</Frame>

<style>
  .section-layout {
    position: absolute;
    left: var(--stage-margin-x);
    right: var(--stage-margin-x);
    top: 50%;
    transform: translateY(-50%);
  }
  .kicker {
    font-family: var(--stage-font-label);
    font-size: var(--stage-size-label);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--stage-accent);
    margin-bottom: 32px;
    min-height: 1lh;
  }
  /* A caption in brackets, as on tobos.ai: [ PART 1 ] */
  .kicker span::before {
    content: '[ ';
  }
  .kicker span::after {
    content: ' ]';
  }
  :global(.tone-dark) .kicker {
    color: inherit;
    opacity: 0.75;
  }
  h1 {
    margin: 0;
    font-size: var(--stage-size-section);
    font-weight: 300;
    line-height: 1.05;
    letter-spacing: -0.035em;
  }
  .subtitle {
    margin: 32px 0 0;
    font-size: var(--stage-size-lead);
    opacity: 0.75;
  }
</style>
