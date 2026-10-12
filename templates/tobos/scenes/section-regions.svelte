<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Section } from '../master/index.ts';
</script>

<Section kicker="kicker" title="title" subtitle="subtitle" />
