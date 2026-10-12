<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Content } from '../master/index.ts';
  import Region from '../lib/Region.svelte';
</script>

<Content headline="headline">
  <Region name="main" fill />
  {#snippet aside()}<Region name="aside" fill />{/snippet}
</Content>
