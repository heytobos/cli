<script module lang="ts">
  import type { Beat } from '@tobos/present';

  export const beats: Beat[] = [
    { id: 'text', enter: (tl, q) => tl.from(q('[data-part=pill]'), { opacity: 0, stagger: 0.1 }) },
    { id: 'ids', enter: (tl, q) => tl.from(q('[data-part=id]'), { opacity: 0, y: -8 }) },
  ];
</script>

<script lang="ts">
  import tokens from '../data/tokens.json';
  import Pill from '../lib/Pill.svelte';
  import { visible } from '../lib/format.ts';
  import { Content } from '../master/index.ts';

  let { beat }: { beat: string } = $props();
</script>

<Content headline="Text becomes numbers">
  <section data-beat={beat}>
    {#each tokens as token (token.id)}
      <Pill text={visible(token.text)} id={token.id} />
    {/each}
  </section>
</Content>

<style>
  section {
    display: flex;
    gap: 24px;
    justify-content: center;
    align-items: center;
    height: 100%;
  }
</style>
