<!--
  Where we are: the chapter's title beside a short bar off the left edge.
  It names the chapter, never the scene: the story carries each scene.
-->
<script lang="ts">
  import { useDeck } from '@tobos/present';

  let { label }: { label?: string } = $props();
  const deck = useDeck();
  const text = $derived(label ?? deck.chapter.title);
</script>

{#if text}
  <div class="wayfinder" data-part="wayfinder">
    <span class="bar"></span>
    <span class="label stage-label">{text}</span>
  </div>
{/if}

<style>
  .wayfinder {
    position: absolute;
    left: 0;
    top: 48px;
    display: flex;
    align-items: center;
    gap: 24px;
  }
  .bar {
    width: 88px;
    height: 8px;
    background: var(--stage-accent);
  }
  .label {
    color: var(--stage-muted);
  }
</style>
