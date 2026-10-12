<!-- The grid's guides over the stage. Hidden unless the viewer's guides are on (press L). -->
<script lang="ts">
  import { column, grid } from '../grid.ts';

  const columns = Array.from({ length: grid.columns }, (_, n) => column(n));
</script>

<svg
  class="tobos-guides-layer"
  viewBox="0 0 {grid.width} {grid.height}"
  aria-hidden="true"
  data-guides
>
  {#each columns as col, n (n)}
    <rect x={col.left} y="0" width={col.width} height={grid.height} class="col" />
  {/each}
  <line x1={grid.marginX} x2={grid.marginX} y1="0" y2={grid.height} />
  <line x1={grid.width - grid.marginX} x2={grid.width - grid.marginX} y1="0" y2={grid.height} />
  <line x1="0" x2={grid.width} y1={grid.marginTop} y2={grid.marginTop} />
  <line x1="0" x2={grid.width} y1={grid.headerBottom} y2={grid.headerBottom} class="soft" />
  <line
    x1="0"
    x2={grid.width}
    y1={grid.height - grid.marginBottom}
    y2={grid.height - grid.marginBottom}
  />
</svg>

<style>
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1000;
  }
  .col {
    fill: rgb(255 0 128 / 0.04);
  }
  line {
    stroke: rgb(255 0 128 / 0.6);
    stroke-width: 2;
  }
  line.soft {
    stroke-dasharray: 8 8;
  }
</style>
