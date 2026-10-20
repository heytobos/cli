<!-- A quotation and who said it. Parts: text, by. -->
<script lang="ts">
  let { text, by }: { text: string; by?: string } = $props();
</script>

<figure class="quote">
  <blockquote data-part="text">{text}</blockquote>
  {#if by}<figcaption class="stage-label" data-part="by">{by}</figcaption>{/if}
</figure>

<style>
  .quote {
    margin: 0;
    max-width: 1400px;
  }
  blockquote {
    margin: 0;
    font-size: var(--stage-size-lead);
    line-height: 1.25;
    text-indent: -0.4em;
  }
  blockquote::before {
    content: '“';
  }
  blockquote::after {
    content: '”';
  }
  figcaption {
    margin-top: 32px;
    color: var(--stage-muted);
  }
</style>
