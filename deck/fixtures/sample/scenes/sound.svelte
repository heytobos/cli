<script module lang="ts">
  import { playAudio, type Beat } from '@tobos/present';

  // A two-second tone in two halves: the first beat is quiet, each click plays one. Then the
  // tone again, from `bed` on through `over`, fading out when `after` is shown.
  export const beats: Beat[] = [
    { id: 'quiet' },
    { id: 'listen', enter: (tl, q) => playAudio(tl, q('[data-part=tone]'), { to: 1 }) },
    { id: 'more', enter: (tl, q) => playAudio(tl, q('[data-part=tone]'), { from: 1 }) },
    {
      id: 'bed',
      enter: (tl, q) => playAudio(tl, q('[data-part=bed]'), { until: 'after' }),
    },
    { id: 'over' },
    { id: 'after' },
  ];
</script>

<script lang="ts">
  import tone from '$media/tone.wav';
  import { Blank } from '../master/index.ts';
</script>

<Blank>
  <section>
    <p>A tone, in two halves.</p>
    <audio data-part="tone" src={tone} preload="auto"></audio>
    <audio data-part="bed" src={tone} preload="auto"></audio>
  </section>
</Blank>

<style>
  section {
    display: grid;
    place-items: center;
    height: 100%;
  }
</style>
