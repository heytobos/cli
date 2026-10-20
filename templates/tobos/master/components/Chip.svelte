<!-- A short label, on the accent's tint by default. Part: chip. -->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    tone = 'soft',
    children,
  }: { tone?: 'soft' | 'outline' | 'ink' | 'highlight'; children: Snippet } = $props();
</script>

<span class="chip stage-label tone-{tone}" data-part="chip">{@render children()}</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 8px 24px;
    border: 2px solid transparent;
    color: var(--stage-ink);
  }
  .tone-soft {
    background: var(--stage-soft);
  }
  .tone-outline {
    border-color: currentColor;
  }
  .tone-ink {
    background: var(--stage-ink);
    color: var(--stage-paper);
  }
  .tone-highlight {
    background: var(--stage-highlight);
    color: var(--stage-paper);
  }
</style>
