<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Blank } from '../master/index.ts';
  const colours = [
    ['paper', '--stage-paper'],
    ['ink', '--stage-ink'],
    ['muted', '--stage-muted'],
    ['rule', '--stage-rule'],
    ['soft', '--stage-soft'],
    ['dark', '--stage-dark'],
    ['highlight', '--stage-highlight'],
  ];
</script>

<Blank>
  <div class="swatches">
    {#each colours as [label, variable] (label)}
      <div class="swatch stage-label">
        <div class="chip" style="background: var({variable})"></div>
        <span>{label}</span>
      </div>
    {/each}
  </div>
</Blank>

<style>
  .swatches {
    position: absolute;
    inset: var(--stage-margin-top) var(--stage-margin-x) var(--stage-margin-bottom);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 48px 32px;
    align-content: center;
  }
  .swatch {
    display: grid;
    gap: 16px;
    color: var(--stage-muted);
  }
  .swatch .chip {
    height: 200px;
    box-shadow: 0 0 0 2px var(--stage-rule);
  }
</style>
