<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Chip, Content } from '../master/index.ts';
</script>

<Content headline="Four tones">
  <div style="display:flex;gap:16px">
    <Chip>soft</Chip><Chip tone="outline">outline</Chip><Chip tone="ink">ink</Chip><Chip
      tone="highlight">highlight</Chip
    >
  </div>
</Content>
