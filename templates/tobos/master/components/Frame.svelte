<!--
  The root of every layout: the stage-sized box, with the guides drawn over it. data-layout names
  the layout, for a beat's selectors and for tests that wait for a scene to be drawn.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Guides from './Guides.svelte';

  let {
    layout,
    tone = 'paper',
    children,
  }: { layout: string; tone?: 'paper' | 'dark' | 'soft'; children?: Snippet } = $props();
</script>

<div class="frame tone-{tone}" data-layout={layout}>
  {@render children?.()}
  <Guides />
</div>

<style>
  .frame {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: var(--stage-paper);
    color: var(--stage-ink);
  }
  /* The palette turned over, for everything in the frame (tokens.css). */
  .tone-dark {
    --stage-paper: var(--stage-dark);
    --stage-ink: var(--stage-dark-ink);
    --stage-accent: var(--stage-dark-ink);
    --stage-muted: var(--stage-dark-muted);
    --stage-rule: var(--stage-dark-rule);
    --stage-soft: var(--stage-dark-soft);
    background: var(--stage-paper);
    color: var(--stage-ink);
  }
  .tone-soft {
    background: var(--stage-soft);
  }
</style>
