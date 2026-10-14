<script lang="ts">
  import { onMount, untrack } from 'svelte';
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
  import { liveResults } from '../responses.svelte.ts';
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
  const results = liveResults();
  const scenes = $derived(chapters.flatMap((c) => c.scenes));
  const hasActivities = $derived(scenes.some((s) => s.activity));
  /** The scene list's numbers line up: each is as wide as the last one. */
  const digits = $derived(String(scenes.length).length);
  /** The current scene's activity, open or revealed. */
  const activityHere = $derived(scenes[position.scene]?.activity);
  /** Answers in the show, to every activity: before Present, what is left from the last one. */
  const answeredAll = $derived(
    Object.values(results.activities).reduce((sum, a) => sum + a.answered, 0),
  );
  /** The room: "312 joined · 204 answered", this scene's while the show is on. */
  const room = $derived(
    !showing
      ? `${results.joined} joined · ${answeredAll} answered`
      : activityHere
        ? `${results.joined} joined · ${results.activities[activityHere.id]?.answered ?? 0} answered`
        : `${results.joined} joined`,
  );
  /** Responses the room has given in this show, or the last one: what Clear clears. */
  const answered = $derived(results.joined > 0 || Object.keys(results.activities).length > 0);

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
    if (showing) report(refOf(to));
  }

  /**
   * The server hears where the show is, so the room's phones follow it: every move while the
   * show is on, and a heartbeat. Presenting never waits for it: a failed report is ignored, and
   * the next one puts it right.
   */
  let reported = false;
  function report(at: BeatRef) {
    if (!config.live) return;
    reported = true;
    fetch(config.live, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(at),
      keepalive: true,
    }).catch(() => undefined);
  }

  /** The show is over: everything open on the phones closes. */
  function reportEnd() {
    if (!config.live || !reported) return;
    reported = false;
    navigator.sendBeacon(config.live, JSON.stringify({ end: true }));
  }

  $effect(() => {
    if (!showing || !config.live) return;
    untrack(() => report(refOf(position)));
    const heartbeat = window.setInterval(() => report(refOf(position)), 20_000);
    return () => window.clearInterval(heartbeat);
  });

  /**
   * Clear the room's responses, so a rehearsal's or the last class's don't show: a new show
   * starts, its counts from zero, and the phones may answer again. The first click asks, the
   * second within a few seconds clears. The CSV keeps every response all the same.
   */
  let confirming = $state(false);
  let clearing = $state(false);
  let confirmTimer = 0;
  function clearResponses() {
    if (!config.live || clearing) return;
    window.clearTimeout(confirmTimer);
    if (!confirming) {
      confirming = true;
      confirmTimer = window.setTimeout(() => (confirming = false), 4000);
      return;
    }
    confirming = false;
    clearing = true;
    fetch(config.live, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restart: true }),
    })
      .catch(() => undefined)
      .finally(() => (clearing = false));
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
    goHome();
  }

  /** The show has ended: back to the deck's page in the app, at this beat. */
  function goHome() {
    reportEnd();
    if (config.home) location.replace(`${config.home}${location.hash}`);
  }

  // A closed audience window ends the show too, unless it was only reloading.
  let wasShowing = false;
  $effect(() => {
    if (showing) {
      wasShowing = true;
      return;
    }
    if (!wasShowing) return;
    const leave = window.setTimeout(goHome, 2000);
    return () => window.clearTimeout(leave);
  });

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
      // Esc in the audience.
      onEnd: goHome,
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
      window.clearTimeout(confirmTimer);
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
    {#if (showing || answered) && config.live && hasActivities}
      <span class="mono room">{room}</span>
    {/if}
    <span class="spacer"></span>
    {#if answered && config.live && hasActivities}
      <button class:confirming disabled={clearing} onclick={clearResponses}
        >{confirming ? 'Click again to clear' : 'Clear responses'}</button
      >
    {/if}
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
                <button class="scene" onclick={() => jump(index, 0)}
                  ><span class="number" style:min-width="{digits}ch">{index + 1}</span
                  >{scene.title}</button
                >
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
  .room {
    color: #fff;
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
  header button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  header button.confirming {
    border-color: var(--pop);
    background: var(--pop);
    color: #fff;
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
  .number {
    display: inline-block;
    margin-right: 8px;
    text-align: right;
    font-family: 'Tobos Mono', ui-monospace, monospace;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--grey);
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
