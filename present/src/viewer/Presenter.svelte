<script lang="ts">
  import { onMount } from 'svelte';
  import { letterbox } from '../letterbox.ts';
  import {
    count,
    formatHash,
    ordinal,
    parseHash,
    START,
    step,
    type Outline,
    type Position,
  } from '../position.ts';
  import { urlForView, type ViewerConfig } from './config.ts';
  import { action } from './keys.ts';
  import { follow } from './live.ts';
  import { Player } from './player.ts';
  import { openAudience } from './screens.ts';
  import { joinSession, type BeatRef } from './session.ts';

  let { config }: { config: ViewerConfig } = $props();

  let currentBox: HTMLElement;
  let nextBox: HTMLElement;
  let position = $state<Position>(START);
  let outline = $state<Outline>({ scenes: [] });
  let chapters = $state<ViewerConfig['manifest']['chapters']>([]);
  let atEnd = $state(false);
  /** The audience window, when this one opened it. */
  let audience = $state<Window | null>(null);
  /** Whether an audience window is open, whichever window opened it. */
  let audienceOpen = $state(false);
  let started = $state<number | null>(null);
  let now = $state(Date.now());

  let current: Player;
  let next: Player;
  let session: ReturnType<typeof joinSession>;

  const total = $derived(outline.scenes.length ? count(outline) : 0);
  const at = $derived(outline.scenes.length ? ordinal(outline, position) + 1 : 0);
  const showing = $derived(audience !== null || audienceOpen);
  const elapsed = $derived(started === null ? null : Math.floor((now - started) / 1000));

  function refOf(p: Position): BeatRef {
    const scene = current.outline.scenes[p.scene]!;
    return { scene: scene.id, beat: scene.beats[p.beat]! };
  }

  function show(to: Position, publish: boolean) {
    position = to;
    current.go(to, false);
    const after = step(current.outline, to, 1);
    const last = ordinal(current.outline, after) === ordinal(current.outline, to);
    atEnd = last;
    next.go(after, false);
    const hash = formatHash(current.outline, to);
    if (location.hash !== hash) history.replaceState(null, '', hash);
    if (publish) session.publish(refOf(to));
  }

  function move(delta: 1 | -1) {
    show(step(current.outline, position, delta), true);
  }

  function jump(scene: number, beat: number) {
    show({ scene, beat }, true);
  }

  async function present() {
    if (showing) return;
    const url = new URL(urlForView('audience'));
    url.hash = formatHash(current.outline, position);
    audience = await openAudience(url.href);
    started ??= Date.now();
  }

  function end() {
    session.end();
    audience?.close();
    audience = null;
    audienceOpen = false;
  }

  function fullscreen() {
    // Capability delegation: this key press lets the audience window go fullscreen.
    audience?.postMessage({ type: 'tobos:fullscreen' }, {
      targetOrigin: location.origin,
      delegate: 'fullscreen',
    } as WindowPostMessageOptions);
  }

  onMount(() => {
    const a = letterbox(currentBox);
    const b = letterbox(nextBox);
    current = new Player(a.stage, config.manifest, { still: true, mountAhead: false });
    next = new Player(b.stage, config.manifest, { still: true, mountAhead: true });
    outline = current.outline;
    chapters = config.manifest.chapters;
    session = joinSession(config.deck, 'presenter', {
      current: () => refOf(position),
      onAudience: (open) => {
        audienceOpen = open;
        if (open) started ??= Date.now();
      },
      onState: (ref) => {
        const to = parseHash(current.outline, `#${ref.scene}/${ref.beat}`);
        if (to) show(to, false);
      },
    });
    show(parseHash(current.outline, location.hash) ?? START, false);

    const onKey = (event: KeyboardEvent) => {
      const what = action(event);
      if (what === 'next' || what === 'prev') {
        event.preventDefault();
        move(what === 'next' ? 1 : -1);
      } else if (what === 'present') present();
      else if (what === 'end') end();
      else if (what === 'fullscreen') fullscreen();
    };
    window.addEventListener('keydown', onKey);
    const closed = window.setInterval(() => {
      if (audience?.closed) audience = null;
      now = Date.now();
    }, 500);
    const stop = follow(
      config,
      () => [current, next],
      () => {
        outline = current.outline;
        chapters = current.manifest.chapters;
      },
    );
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearInterval(closed);
      stop();
      session.close();
      current.destroy();
      next.destroy();
    };
  });

  function sceneIndex(chapter: number, scene: number): number {
    let n = 0;
    for (let c = 0; c < chapter; c++) n += chapters[c]!.scenes.length;
    return n + scene;
  }

  const clock = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
</script>

<div class="presenter">
  <header>
    <strong>{config.manifest.title}</strong>
    <span class="mono">{at} / {total}</span>
    {#if elapsed !== null}<span class="mono">{clock(elapsed)}</span>{/if}
    <span class="spacer"></span>
    {#if showing}
      <button onclick={end}>End show</button>
    {:else}
      <button class="primary" onclick={present}>Present</button>
    {/if}
  </header>
  <main>
    <section class="now">
      <div class="label">Now</div>
      <div class="box" bind:this={currentBox}></div>
    </section>
    <aside>
      <div class="label">{atEnd ? 'Next: the end of the deck' : 'Next'}</div>
      <div class="box next" class:end={atEnd} bind:this={nextBox}></div>
      <nav aria-label="Scenes">
        {#each chapters as chapter, c (chapter.id)}
          <h3>{chapter.title}</h3>
          <ol>
            {#each chapter.scenes as scene, s (scene.id)}
              {@const index = sceneIndex(c, s)}
              <li
                class:current={index === position.scene}
                aria-current={index === position.scene ? 'step' : undefined}
              >
                <button class="scene" onclick={() => jump(index, 0)}>{scene.title}</button>
                <span class="beats">
                  {#each scene.beats as beat, b (beat)}
                    {@const here = index === position.scene && b === position.beat}
                    <button
                      class="beat"
                      class:current={here}
                      title={beat}
                      aria-label={`${scene.title}: ${beat}`}
                      aria-current={here ? 'step' : undefined}
                      onclick={() => jump(index, b)}
                    ></button>
                  {/each}
                </span>
              </li>
            {/each}
          </ol>
        {/each}
      </nav>
    </aside>
  </main>
  <footer>
    → / Space next · ← back · {#if audience}F fullscreen · Esc end{:else if showing}click the
      audience for fullscreen · Esc end{:else}⌘/Ctrl-Enter present{/if}
  </footer>
</div>

<style>
  /* Dark, so the slides are what you look at: tobos.ai's ink as the ground, its faces, and its
     one red for where you are. The colours are copies of @tobos/site's tokens.css. */
  .presenter {
    --ink: #121a2c;
    --grey: #a5abb8;
    --line: rgba(255, 255, 255, 0.12);
    --pop: #ef4423;
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 16px;
    padding: 14px 20px;
    box-sizing: border-box;
    background: var(--ink);
    color: #fff;
    font:
      300 14px/1.4 'Tobos Sans',
      system-ui,
      sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }
  header strong {
    font-weight: 400;
    font-size: 16px;
  }
  .mono,
  .label,
  footer {
    font-family: 'Tobos Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    color: var(--grey);
  }
  .mono {
    font-size: 13px;
  }
  .spacer {
    flex: 1;
  }
  header button {
    padding: 11px 16px;
    border: 1px solid #fff;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 10.5px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      background 0.3s cubic-bezier(0.22, 0.61, 0.24, 1),
      color 0.3s cubic-bezier(0.22, 0.61, 0.24, 1);
  }
  header button:hover,
  header button.primary {
    background: #fff;
    color: var(--ink);
  }
  header button.primary:hover {
    background: var(--grey);
  }
  main {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
    gap: 20px;
    min-height: 0;
  }
  .now {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  /* A caption in brackets, as on tobos.ai: [ NOW ] */
  .label {
    margin-bottom: 8px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .label::before {
    content: '[ ';
  }
  .label::after {
    content: ' ]';
  }
  /* A letterbox: the slides sit on the ground, not in black bars. */
  .box {
    background: transparent;
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .box.next {
    flex: none;
    aspect-ratio: 16 / 9;
  }
  .box.next.end {
    visibility: hidden;
  }
  aside {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  nav {
    overflow: auto;
    margin-top: 16px;
  }
  h3 {
    margin: 14px 0 4px;
    font-size: 12px;
    font-weight: 500;
    color: var(--grey);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
  }
  li.current {
    background: rgba(255, 255, 255, 0.08);
  }
  .scene {
    all: unset;
    flex: 1;
    cursor: pointer;
  }
  .beats {
    display: flex;
    gap: 4px;
  }
  .beat {
    all: unset;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.25);
    cursor: pointer;
  }
  .beat.current {
    background: var(--pop);
  }
  footer {
    font-size: 11px;
  }
</style>
