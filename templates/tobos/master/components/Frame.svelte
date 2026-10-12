<!-- The root of every layout: the stage-sized box, with the guides drawn over it. -->
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
  .tone-dark {
    background: var(--stage-dark);
    color: var(--stage-paper);
  }
  .tone-soft {
    background: var(--stage-soft);
  }
</style>
