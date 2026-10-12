<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Content, Quote } from '../master/index.ts';
</script>

<Content wayfinder={false}>
  <Quote
    text="Every aspect of learning or any other feature of intelligence can in principle be so precisely described that a machine can be made to simulate it."
    by="McCarthy, Minsky, Rochester, Shannon · 1955"
  />
</Content>
