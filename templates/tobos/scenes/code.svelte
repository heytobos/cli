<script module lang="ts">
  import type { Beat } from '@tobos/present';
  export const beats: Beat[] = [{ id: 'plate' }];
</script>

<script lang="ts">
  import { Code, Content } from '../master/index.ts';
</script>

<Content headline="Tokenising a sentence">
  <Code
    code={`import tiktoken\nenc = tiktoken.get_encoding("cl100k_base")\nids = enc.encode("The cow jumped")\nprint(ids)  # [791, 19923, 27096]`}
    bright={[2, 3]}
  />
</Content>
