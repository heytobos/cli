<!--
  Code, one element per line, so beats can walk through it: q('[data-line="3"]').
  `focus` dims every other line (1-based line numbers).
-->
<script lang="ts">
  let { code, focus = [] }: { code: string; focus?: number[] } = $props();
  const lines = $derived(code.replace(/\n$/, '').split('\n'));
</script>

<pre class="code" data-part="code"><code
    >{#each lines as line, i (i)}<span
        class="line"
        class:dim={focus.length > 0 && !focus.includes(i + 1)}
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
