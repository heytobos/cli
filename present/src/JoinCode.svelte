<!--
  The deck's join code: a QR code and the link it holds, for phones to answer the deck's
  activities. The server draws the QR code (join.svg, beside the viewer page). A scene that
  wants them laid out its own way takes the parts from useJoin().
-->
<script lang="ts">
  import { isShared, joinInfo } from './registry.ts';

  let { size = 480 }: { size?: number } = $props();
  const join = joinInfo();
</script>

<!-- A share link never opens a room, so its page shows no join code, nor a place for one. -->
{#if !isShared()}
  <figure class="tobos-join">
    {#if join}
      <img src={join.qr} alt="QR code for {join.link}" width={size} height={size} />
      <figcaption>{join.link}</figcaption>
    {:else}
      <div class="tobos-join-none" style:width="{size}px" style:height="{size}px"></div>
      <figcaption>The join code appears here once the deck has an activity.</figcaption>
    {/if}
  </figure>
{/if}

<style>
  .tobos-join {
    margin: 0;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4em;
  }
  img {
    display: block;
    image-rendering: pixelated;
  }
  .tobos-join-none {
    border: 4px dashed currentColor;
    opacity: 0.3;
  }
  /* The link people type: on one line, as wide as it needs. */
  figcaption {
    font: inherit;
    white-space: nowrap;
  }
</style>
