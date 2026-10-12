<!--
  The parts of the talk, from deck.json, with the current one highlighted. Each item is
  data-part="item", so a beat can reveal them one by one.
-->
<script lang="ts">
  import { useDeck } from '@tobos/present';
  import Frame from '../components/Frame.svelte';
  import Wayfinder from '../components/Wayfinder.svelte';

  let {
    title = 'Today',
    current,
    skip = [],
  }: {
    title?: string;
    /** The chapter to highlight; defaults to none on the first chapter, else the current one. */
    current?: string | null;
    /** Chapter IDs to leave out (the opening, say). */
    skip?: string[];
  } = $props();
  const deck = useDeck();
  const chapters = $derived((deck?.chapters ?? []).filter((c) => !skip.includes(c.id)));
  const highlight = $derived(current === undefined ? deck?.chapter.id : current);
</script>

<Frame layout="agenda">
  <Wayfinder label={title} />
  <ol class="agenda-layout" data-region="items">
    {#each chapters as chapter, i (chapter.id)}
      <li
        data-part="item"
        class:current={chapter.id === highlight}
        class:other={highlight && chapter.id !== highlight}
      >
        <span class="number">{String(i + 1).padStart(2, '0')}</span>
        <span class="name">{chapter.title}</span>
      </li>
    {/each}
  </ol>
</Frame>

<style>
  .agenda-layout {
    position: absolute;
    left: var(--stage-margin-x);
    right: var(--stage-margin-x);
    top: 200px;
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  li {
    display: flex;
    align-items: baseline;
    gap: 48px;
    font-size: var(--stage-size-lead);
  }
  .number {
    font-family: var(--stage-font-label);
    font-size: var(--stage-size-body);
    color: var(--stage-accent);
    min-width: 72px;
  }
  .current .name {
    font-weight: 500;
  }
  .other {
    opacity: var(--stage-opacity-muted);
  }
</style>
