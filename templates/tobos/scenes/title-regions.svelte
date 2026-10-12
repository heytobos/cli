<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Title } from '../master/index.ts';
</script>

<Title kicker="kicker" title="title" subtitle="subtitle" />
