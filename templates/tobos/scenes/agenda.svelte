<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Agenda } from '../master/index.ts';
</script>

<!-- The deck's chapters. A deck with none lists what it is given: <Agenda items={['Why', 'How']} /> -->
<Agenda />
