<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Content, Stat } from '../master/index.ts';
</script>

<Content headline="A model never sees words, only numbers">
  <p style="margin:0">
    Before anything else happens, the text is cut into tokens, and every token is looked up in a
    vocabulary of about 100,000 entries.
  </p>
  {#snippet aside()}
    <Stat value="100,277" label="tokens in the vocabulary" />
  {/snippet}
</Content>
