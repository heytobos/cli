<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Blank } from '../master/index.ts';
  const sizes = ['display', 'section', 'title', 'lead', 'body', 'code', 'label'];
</script>

<Blank>
  <div class="scale">
    {#each sizes as size (size)}
      <div style="font-size: var(--stage-size-{size})">
        <span class="name">{size}</span> Same problem
      </div>
    {/each}
  </div>
</Blank>

<style>
  .scale {
    padding: 64px 112px;
    line-height: 1.1;
  }
  .name {
    display: inline-block;
    width: 320px;
    font-family: var(--stage-font-label);
    font-size: 28px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--stage-muted);
  }
</style>
