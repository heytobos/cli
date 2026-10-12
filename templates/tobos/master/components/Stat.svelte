<!-- One number that matters, with what it counts. Parts: value, label. -->
<script lang="ts">
  let {
    value,
    label,
    tone = 'accent',
  }: { value: string; label: string; tone?: 'accent' | 'ink' | 'highlight' } = $props();
</script>

<div class="stat tone-{tone}">
  <div class="value" data-part="value">{value}</div>
  <div class="label" data-part="label">{label}</div>
</div>

<style>
  .stat {
    display: inline-flex;
    flex-direction: column;
    gap: 8px;
  }
  .value {
    font-size: var(--stage-size-display);
    font-weight: 200;
    line-height: 1;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
  }
  .tone-accent .value {
    color: var(--stage-accent);
  }
  .tone-highlight .value {
    color: var(--stage-highlight);
  }
  .label {
    font-size: var(--stage-size-body);
    color: var(--stage-muted);
  }
</style>
