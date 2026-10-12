<!--
  The whole stage for the scene: no margins, no wayfinder. For full-bleed images,
  diagrams and anything bespoke. Region: main (children).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Frame from '../components/Frame.svelte';

  let { tone = 'paper', children }: { tone?: 'paper' | 'dark' | 'soft'; children?: Snippet } =
    $props();
</script>

<Frame layout="blank" {tone}>
  <div class="blank-layout" data-region="main">{@render children?.()}</div>
</Frame>

<style>
  .blank-layout {
    position: absolute;
    inset: 0;
  }
</style>
