<!--
  Code, one element per line, so beats can walk through it: q('[data-line="3"]').
  `bright` keeps those lines bright and dims the rest (1-based line numbers).
-->
<script lang="ts">
  let { code, bright = [] }: { code: string; bright?: number[] } = $props();
  const lines = $derived(code.replace(/\n$/, '').split('\n'));
</script>

<pre class="code" data-part="code"><code
    >{#each lines as line, i (i)}<span
        class="line"
        class:dim={bright.length > 0 && !bright.includes(i + 1)}
        data-line={i + 1}>{line || ' '}</span
      >{/each}</code
  ></pre>

<style>
  .code {
    margin: 0;
    font-family: var(--stage-font-mono);
    font-size: var(--stage-size-code);
    line-height: 1.45;
    tab-size: 2;
  }
  .line {
    display: block;
    white-space: pre;
  }
  .dim {
    opacity: var(--stage-opacity-dim);
  }
</style>
