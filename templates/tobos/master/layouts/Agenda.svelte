<!--
  The parts of the talk: the deck's chapters, from its outline, with the current one highlighted,
  or the items it is given, as a deck with no chapters has none to list. Each item is
  data-part="item", so a beat can reveal them one by one.
-->
<script lang="ts">
  import { useDeck } from '@tobos/present';
  import Frame from '../components/Frame.svelte';
  import Wayfinder from '../components/Wayfinder.svelte';

  let {
    title = 'Today',
    items,
    current,
    skip = [],
  }: {
    title?: string;
    /** What to list instead of the chapters: a deck with none can have an agenda too. */
    items?: string[];
    /** The chapter to highlight; defaults to none on the first chapter, else the current one. */
    current?: string | null;
    /** Chapter IDs to leave out (the opening, say). */
    skip?: string[];
  } = $props();
  const deck = useDeck();
  const chapters = $derived((deck?.chapters ?? []).filter((c) => !skip.includes(c.id)));
  // Only a chapter the list shows: on a slide in a chapter it leaves out (the opening, say),
  // none is highlighted, and none dimmed. Items given name no chapter, so none is.
  const highlight = $derived.by(() => {
    if (items) return null;
    const id = current === undefined ? deck?.chapter.id : current;
    return chapters.some((c) => c.id === id) ? id : null;
  });
  const listed = $derived(items ? items.map((title, i) => ({ id: `item-${i}`, title })) : chapters);
</script>

<Frame layout="agenda">
  <Wayfinder label={title} />
  <ol class="agenda-layout" data-region="items">
    {#each listed as item, i (item.id)}
      <li
        data-part="item"
        class:current={item.id === highlight}
        class:other={highlight && item.id !== highlight}
      >
        <span class="number">{String(i + 1).padStart(2, '0')}</span>
        <span class="name">{item.title}</span>
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
