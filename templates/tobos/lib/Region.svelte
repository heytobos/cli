<!-- A labelled placeholder for a layout's region, as in a slide master. -->
<script lang="ts">
  let { name, fill = false }: { name: string; fill?: boolean } = $props();
</script>

<div class="region" class:fill>{name}</div>

<style>
  /* The region's extent, in the current colour. */
  .region {
    display: grid;
    place-items: center;
    min-height: 160px;
    outline: 4px dashed;
    outline-offset: -4px;
  }
  .fill {
    position: absolute;
    inset: 0;
  }
</style>
