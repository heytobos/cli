<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Blank } from '../master/index.ts';
  import Region from '../lib/Region.svelte';
</script>

<Blank><Region name="main" fill /></Blank>
