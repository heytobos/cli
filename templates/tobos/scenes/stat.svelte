<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Content, Stat } from '../master/index.ts';
</script>

<Content headline="Three numbers">
  <div style="display:flex;gap:96px;align-items:flex-end">
    <Stat value="$65B" label="raised in 2025" />
    <Stat value="1955" label="the proposal" tone="ink" />
    <Stat value="2" label="months, as planned" tone="highlight" />
  </div>
</Content>
