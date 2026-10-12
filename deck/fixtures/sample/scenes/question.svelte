<script module lang="ts">
  import type { Beat } from '@tobos/present';

  export const beats = [
    { id: 'scan' },
    {
      id: 'ask',
      enter: (tl, q) => tl.from(q('[data-part=ask]'), { opacity: 0, y: 24, duration: 0.6 }),
    },
  ] satisfies Beat[];
</script>

<script lang="ts">
  import { media } from '@tobos/present';
  import { Blank } from '../master/index.ts';
</script>

<Blank>
  <section>
    <img src={media('scan.png')} alt="The 1955 Dartmouth proposal" />
    <p data-part="ask">What would it take for a machine to use language?</p>
  </section>
</Blank>

<style>
  section {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 64px;
    align-items: center;
    height: 100%;
    padding: 0 112px;
  }
  img {
    width: 100%;
  }
  p {
    font-size: 52px;
  }
</style>
