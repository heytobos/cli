<script module lang="ts">
  import { playVideo, type Beat } from '@tobos/present';

  // A two-second clip in two halves: the first beat holds its first frame, each click plays one.
  export const beats: Beat[] = [
    { id: 'start' },
    { id: 'half', enter: (tl, q) => playVideo(tl, q('video'), { to: 1 }) },
    { id: 'rest', enter: (tl, q) => playVideo(tl, q('video'), { from: 1 }) },
  ];
</script>

<script lang="ts">
  import { media } from '@tobos/present';
  import { Blank } from '../master/index.ts';
</script>

<Blank>
  <section>
    <video src={media('clip.webm')} muted playsinline preload="auto"></video>
  </section>
</Blank>

<style>
  section {
    display: grid;
    place-items: center;
    height: 100%;
  }
  video {
    width: 1280px;
    height: 720px;
  }
</style>
