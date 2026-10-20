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
        <span class="name stage-label">{size}</span> Same problem
      </div>
    {/each}
  </div>
</Blank>

<style>
  .scale {
    padding: var(--stage-margin-top) var(--stage-margin-x) var(--stage-margin-bottom);
    line-height: 1.1;
  }
  .name {
    display: inline-block;
    width: 320px;
    color: var(--stage-muted);
  }
</style>
