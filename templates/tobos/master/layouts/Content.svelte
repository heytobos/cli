<!--
  The working layout. Regions: headline (optional), main (children), aside (optional:
  a second column). The wayfinder shows the chapter; turn it off with wayfinder={false}.
  Main and aside are centred in the height below the headline; align="top" starts them under it.
  The main region is position: relative, so a scene can place things absolutely inside it.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import Frame from '../components/Frame.svelte';
  import Wayfinder from '../components/Wayfinder.svelte';

  let {
    headline,
    wayfinder = true,
    split = 'half',
    align = 'center',
    children,
    aside,
  }: {
    headline?: string;
    wayfinder?: boolean | string;
    /** How main and aside share the width, when there is an aside. */
    split?: 'half' | 'wide' | 'narrow';
    /** Where main and aside sit in the height below the headline. */
    align?: 'center' | 'top';
    children?: Snippet;
    aside?: Snippet;
  } = $props();
</script>

<Frame layout="content">
  {#if wayfinder}
    <Wayfinder label={typeof wayfinder === 'string' ? wayfinder : undefined} />
  {/if}
  <div class="content-layout" class:has-headline={headline}>
    {#if headline}<h2 data-region="headline">{headline}</h2>{/if}
    <div class="body split-{split} align-{align}" class:has-aside={aside}>
      <div class="main" data-region="main">{@render children?.()}</div>
      {#if aside}<div class="aside" data-region="aside">{@render aside()}</div>{/if}
    </div>
  </div>
</Frame>

<style>
  .content-layout {
    position: absolute;
    left: var(--stage-margin-x);
    right: var(--stage-margin-x);
    top: 168px;
    bottom: var(--stage-margin-bottom);
    display: flex;
    flex-direction: column;
  }
  h2 {
    margin: 0 0 48px;
    font-size: var(--stage-size-title);
    font-weight: 400;
    line-height: 1.1;
    letter-spacing: -0.025em;
    max-width: 1500px;
  }
  .body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 64px;
  }
  .body.has-aside.split-half {
    grid-template-columns: 1fr 1fr;
  }
  .body.has-aside.split-wide {
    grid-template-columns: 2fr 1fr;
  }
  .body.has-aside.split-narrow {
    grid-template-columns: 1fr 2fr;
  }
  .main,
  .aside {
    position: relative;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .align-center > .main,
  .align-center > .aside {
    justify-content: center;
  }
</style>
