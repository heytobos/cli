<!--
  The deck's opening. Regions: kicker, title, subtitle.
  The kicker defaults to nothing; the title to the deck's title.
-->
<script lang="ts">
  import { useDeck } from '@tobos/present';
  import Frame from '../components/Frame.svelte';

  let { title, subtitle, kicker }: { title?: string; subtitle?: string; kicker?: string } =
    $props();
  const deck = useDeck();
</script>

<Frame layout="title">
  <div class="title-layout">
    {#if kicker}<div class="kicker" data-region="kicker">{kicker}</div>{/if}
    <h1 data-region="title">{title ?? deck?.title}</h1>
    {#if subtitle}<p class="subtitle" data-region="subtitle">{subtitle}</p>{/if}
  </div>
  <div class="mark" aria-hidden="true"></div>
</Frame>

<style>
  .title-layout {
    position: absolute;
    left: var(--stage-margin-x);
    right: var(--stage-margin-x);
    bottom: 288px;
  }
  .kicker {
    font-family: var(--stage-font-label);
    font-size: var(--stage-size-label);
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--stage-accent);
    margin-bottom: 32px;
  }
  /* A caption in brackets, as on tobos.ai: [ LECTURE 1 ] */
  .kicker::before {
    content: '[ ';
  }
  .kicker::after {
    content: ' ]';
  }
  h1 {
    margin: 0;
    font-size: var(--stage-size-display);
    font-weight: 300;
    line-height: 1.02;
    letter-spacing: -0.035em;
    max-width: 1500px;
  }
  .subtitle {
    margin: 40px 0 0;
    font-size: var(--stage-size-lead);
    color: var(--stage-muted);
  }
  .mark {
    position: absolute;
    left: 0;
    bottom: 160px;
    width: 88px;
    height: 8px;
    background: var(--stage-accent);
  }
</style>
