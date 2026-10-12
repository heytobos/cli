<script module lang="ts">
  import type { Beat } from '@tobos/present';
  import { motion } from '../master/index.ts';

  export const beats: Beat[] = [
    {
      id: 'title',
      enter: (tl, q) => tl.from(q('[data-region=title]'), { ...motion.enter, opacity: 0, y: 32 }),
    },
  ];
</script>

<script lang="ts">
  import { Title } from '../master/index.ts';
</script>

<Title kicker="194.207 · Lecture 1" subtitle="Generative AI" />
