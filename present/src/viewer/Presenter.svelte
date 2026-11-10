<script lang="ts">
  import AArrowDown from '@lucide/svelte/icons/a-arrow-down';
  import AArrowUp from '@lucide/svelte/icons/a-arrow-up';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Square from '@lucide/svelte/icons/square';
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { letterbox } from '../letterbox.ts';
  import {
    firstShown,
    formatHash,
    parseHash,
    same,
    sceneStep,
    START,
    step,
    type Outline,
    type Position,
  } from '../position.ts';
  import { liveResults } from '../responses.svelte.ts';
  import { projectorUrl, showHash, type ViewerConfig } from './config.ts';
  import { Confirm } from './confirm.svelte.ts';
  import { duration, NEW_TIMER, reset, seconds, started, toggled } from './timer.ts';
  import {
    action,
    actionMessage,
    moveOf,
    presenterKey,
    type Move,
    type PresenterKey,
  } from './keys.ts';
  import {
    arrange,
    DEFAULT_LAYOUT,
    dragLeft,
    dragSlide,
    GUTTER,
    loadLayout,
    noteSize,
    NOTE_SIZES,
    saveLayout,
    type Layout,
  } from './layout.ts';
  import { follow } from './live.ts';
  import { listen } from './events.ts';
  import { Player } from './player.ts';
  import { audienceIn, openAudience } from './screens.ts';
  import { joinWindows, type BeatRef } from './windows.ts';

  let { config }: { config: ViewerConfig } = $props();

  let currentBox: HTMLElement;
  let nextBox: HTMLElement;
  let position = $state<Position>(START);
  let outline = $state<Outline>({ scenes: [] });
  let chapters = $state<ViewerConfig['manifest']['chapters']>([]);
  let title = $state('');
  let atEnd = $state(false);
  /** The audience window, when this one opened it or the audience made itself known (screens.ts). */
  let audience = $state<Window | null>(null);
  /** Whether an audience window is open, whichever window opened it. */
  let audienceOpen = $state(false);
  /** The audience refused fullscreen to F here, as outside Chromium: it takes a click there. */
  let fullscreenRefused = $state(false);
  let now = $state(Date.now());

  let current: Player;
  let next: Player;
  let sync: ReturnType<typeof joinWindows>;

  /** The scene's number in the outline, of all of them: a hidden scene keeps its number and counts. */
  const total = $derived(outline.scenes.length);
  const at = $derived(total ? position.scene + 1 : 0);
  const hiddenHere = $derived(!!outline.scenes[position.scene]?.hidden);
  const showing = $derived(audience !== null || audienceOpen);
  const results = liveResults();
  const scenes = $derived(chapters.flatMap((c) => c.scenes));
  const hasActivities = $derived(scenes.some((s) => s.activity));
  /** The chapter the stage is in, its heading lit. */
  const chapterHere = $derived.by(() => {
    let n = 0;
    return chapters.findIndex((c) => position.scene < (n += c.scenes.length));
  });
  /** The scene list's numbers line up: each is as wide as the last one. */
  const digits = $derived(String(scenes.length).length);
  /** Each scene's notes, by its id, in their paragraphs: the speaker's notes (notes.ts). */
  let notes = $state<Record<string, string[]>>({});
  const notesHere = $derived.by(() => {
    const id = scenes[position.scene]?.id ?? '';
    return Object.hasOwn(notes, id) ? notes[id]! : [];
  });
  /** The current scene's activity, open or revealed. */
  const activityHere = $derived(scenes[position.scene]?.activity);
  /** Answers in the session, to every poll: before Present, what is left from the last one. */
  const answeredAll = $derived(
    Object.values(results.activities).reduce((sum, a) => sum + a.answered, 0),
  );
  /** The room: "312 joined · 204 answered", this scene's while presenting. */
  const room = $derived(
    !showing
      ? `${results.joined} joined · ${answeredAll} answered`
      : activityHere
        ? `${results.joined} joined · ${results.activities[activityHere.id]?.answered ?? 0} answered`
        : `${results.joined} joined`,
  );
  /**
   * Answers the room has given in this session, or the last one: New session is offered once
   * there are some. Not who joined: phones still following are in the next session too.
   */
  const answered = $derived(Object.keys(results.activities).length > 0);

  /** The timer, from the first Present; the clock beside it is the time of day. */
  let timer = $state.raw(NEW_TIMER);
  const elapsed = $derived(seconds(timer, now));
  const pauseTimer = () => (timer = toggled(timer, (now = Date.now())));
  const resetting = new Confirm(3000);
  const stopping = new Confirm(3000);

  /** The layout: the dividers where they were dragged, and the notes' size, in this browser. */
  const storage = () => {
    try {
      return typeof localStorage === 'undefined' ? undefined : localStorage;
    } catch {
      // Reading it throws where the browser blocks a site's data: the layout then holds until the page goes.
      return undefined;
    }
  };
  let layout = $state<Layout>(loadLayout(storage()));
  let mainWidth = $state(0);
  let mainHeight = $state(0);
  let nowLabel = $state(0);
  let dragging = $state<'left' | 'slide' | null>(null);
  let mainEl: HTMLElement;
  /** Notes come from the server, with a live deck: without, the slide takes the column. */
  const hasNotes = $derived(!!(config.live && config.events));
  const sized = $derived(
    arrange(layout, {
      width: mainWidth,
      height: mainHeight,
      label: nowLabel + 8,
      notes: hasNotes,
    }),
  );

  function relayout(change: Partial<Layout>) {
    layout = { ...layout, ...change };
    saveLayout(storage(), layout);
  }

  /** A divider follows the pointer while it is down; a double click puts it back. */
  function drag(which: 'left' | 'slide', event: PointerEvent) {
    const gutter = event.currentTarget as HTMLElement;
    const area = (which === 'left' ? mainEl : gutter.parentElement!).getBoundingClientRect();
    gutter.setPointerCapture(event.pointerId);
    dragging = which;
    const onMove = (e: PointerEvent) => {
      if (which === 'left') layout.left = dragLeft(e.clientX - area.left, area.width);
      else layout.slide = dragSlide(e.clientY - area.top, area.height, sized.fullSlide);
    };
    const onUp = () => {
      dragging = null;
      // A click on a divider focuses it; the arrows go back to the stage once it is let go.
      gutter.blur();
      saveLayout(storage(), layout);
      gutter.removeEventListener('pointermove', onMove);
      gutter.removeEventListener('pointerup', onUp);
      gutter.removeEventListener('pointercancel', onUp);
    };
    gutter.addEventListener('pointermove', onMove);
    gutter.addEventListener('pointerup', onUp);
    gutter.addEventListener('pointercancel', onUp);
  }

  /** By keyboard, a divider in focus moves with its arrows, not the stage. */
  function nudge(which: 'left' | 'slide', event: KeyboardEvent) {
    const by = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (which === 'left')
      relayout({ left: dragLeft((sized.left + GUTTER / 2) / mainWidth + by * 0.02, 1) });
    else
      relayout({
        slide: dragSlide(
          sized.pane + GUTTER / 2 + by * 0.02 * mainHeight,
          mainHeight,
          sized.fullSlide,
        ),
      });
  }

  /** The notes: their place kept through a scene's beats, and how many paragraphs are below. */
  let notesEl = $state<HTMLElement>();
  let notesBelow = $state(0);
  let notesAbove = $state(false);
  const sceneId = $derived(scenes[position.scene]?.id);

  function measureNotes() {
    const n = notesEl;
    if (!n) return;
    notesAbove = n.scrollTop > 4;
    const more = n.scrollTop + n.clientHeight < n.scrollHeight - 4;
    const fold = n.scrollTop + n.clientHeight - 24;
    notesBelow = more
      ? Math.max(1, [...n.querySelectorAll('p')].filter((p) => p.offsetTop > fold).length)
      : 0;
  }

  /**
   * ⇧↓ and ⇧↑: to the next paragraph that starts below the top, or the one before, set just under
   * the top's fade.
   */
  function scrollNotes(by: 1 | -1) {
    const n = notesEl;
    if (!n) return;
    const fade = 1.2 * layout.notes;
    const tops = [...n.querySelectorAll('p')].map((p) => Math.max(0, p.offsetTop - fade));
    const to =
      by > 0
        ? tops.find((t) => t > n.scrollTop + 4)
        : tops.filter((t) => t < n.scrollTop - 4).at(-1);
    n.scrollTo({ top: to ?? (by > 0 ? n.scrollHeight : 0), behavior: 'smooth' });
  }

  $effect(() => {
    void sceneId;
    untrack(() => {
      if (notesEl) notesEl.scrollTop = 0;
    });
  });
  $effect(() => {
    void [notesHere, layout.notes, sized];
    untrack(() => void tick().then(measureNotes));
  });

  /**
   * Scenes the audience has seen, while presenting: listed grey, as done. Presenting begun or
   * joined mid-way, those before it showed.
   */
  const seen = new SvelteSet<string>();
  function markSeen(at: Position) {
    const all = current.outline.scenes;
    if (!seen.size) for (let s = 0; s < at.scene; s++) if (!all[s]!.hidden) seen.add(all[s]!.id);
    if (all[at.scene]) seen.add(all[at.scene]!.id);
  }
  $effect(() => {
    if (showing) untrack(() => markSeen(position));
  });

  /**
   * Where the presenter was before a jump in the list, as a hash: Back (⌫) goes there, until they
   * go on to another scene.
   */
  let back = $state<string | null>(null);
  const backTo = $derived(back === null ? undefined : parseHash(outline, back));

  /** The list follows the stage: the current scene a third of the way down, under its chapter. */
  let nav = $state<HTMLElement>();
  let moreScenes = $state(false);
  /** A scroll of the list by hand holds it there a few seconds; a key press lets it follow again. */
  let heldUntil = 0;
  let fromList = false;
  let listed = false;

  /** A chapter's heading's height: none in a deck with no chapters, whose one has no title. */
  const headingOf = (section: Element) =>
    section.querySelector<HTMLElement>('h3')?.offsetHeight ?? 0;
  /** How far below a row's chapter heading, stuck on top, the row has to be to show whole. */
  const underHeading = (li: HTMLElement) => headingOf(li.closest('section')!) + 8;

  /** A scroll that leaves whole rows under the chapter's heading: its start, or a row just clear of it. */
  function listTarget(list: HTMLElement, li: HTMLElement): number {
    const head = underHeading(li);
    const want = Math.max(0, li.offsetTop - Math.max(list.clientHeight / 3, head));
    const marks = [...list.querySelectorAll('section')].flatMap((section) => {
      const h = headingOf(section);
      const rows = [...section.querySelectorAll('li')].slice(1);
      return [section.offsetTop, ...rows.map((r) => r.offsetTop - h)];
    });
    const most = list.scrollHeight - list.clientHeight;
    const to = Math.max(0, ...marks.filter((m) => m <= Math.min(want, most)));
    return to + list.clientHeight >= li.offsetTop + li.offsetHeight + 8 ? to : want;
  }

  function followList(smooth: boolean) {
    const list = nav;
    const li = list?.querySelector<HTMLElement>('li.current');
    if (!list || !li || Date.now() < heldUntil) return;
    const head = underHeading(li);
    const top = li.offsetTop;
    const bottom = top + li.offsetHeight;
    if (
      top < list.scrollTop + Math.max(40, head) ||
      bottom > list.scrollTop + list.clientHeight - 40
    )
      list.scrollTo({ top: listTarget(list, li), behavior: smooth ? 'smooth' : 'instant' });
  }

  function measureList() {
    const list = nav;
    const last = list?.querySelector<HTMLElement>('section:last-child');
    moreScenes =
      !!list &&
      !!last &&
      last.offsetTop + last.offsetHeight > list.scrollTop + list.clientHeight + 4;
  }

  $effect(() => {
    void [position.scene, position.beat, chapters];
    untrack(() => {
      if (!chapters.length) return;
      const smooth = listed;
      listed = true;
      if (fromList) {
        fromList = false;
        void tick().then(measureList);
        return;
      }
      void tick().then(() => {
        followList(smooth);
        measureList();
      });
    });
  });

  function refOf(p: Position): BeatRef {
    const scene = current.outline.scenes[p.scene]!;
    return { scene: scene.id, beat: scene.beats[p.beat]! };
  }

  function show(to: Position, publish: boolean, keepBack = false) {
    if (!keepBack && to.scene !== position.scene) back = null;
    if (showing) markSeen(to);
    position = to;
    current.go(to, false);
    const after = step(current.outline, to, 1);
    atEnd = same(after, to);
    next.go(after, false);
    const hash = formatHash(current.outline, to);
    showHash(hash);
    if (publish) sync.publish(refOf(to));
    if (showing) report(refOf(to));
  }

  /**
   * The server hears where the presenter is, so the room's phones follow: every move while
   * presenting, a heartbeat, and as the window's stream comes back. Presenting never waits for it:
   * a failed report is ignored, and the next one puts it right.
   */
  let reported = false;
  let lastReport: Promise<unknown> = Promise.resolve();
  /** The end on its way: no move is reported after it, which would open the session again. */
  let ending: Promise<void> | undefined;
  function report(at: BeatRef) {
    if (ending || !config.live) return;
    reported = true;
    lastReport = post(config.live, at);
  }

  /**
   * Presenting has stopped: everything open on the phones closes. As JSON, the way every report goes,
   * never a beacon: a beacon's text is a form's to the server, and Safari and Firefox send it from
   * this page (no referrer) with its origin as `null`, which the server takes for another site's.
   * After the last move's report, which landing after the end would open the session again; for half
   * a second at most, since the page is leaving. Ended again meanwhile, as by Esc twice, it waits
   * for the same end, rather than leave before it goes.
   */
  function reportEnd(): Promise<void> {
    const live = config.live;
    if (ending || !live || !reported) return ending ?? Promise.resolve();
    reported = false;
    ending = Promise.race([lastReport, new Promise((resolve) => setTimeout(resolve, 500))])
      .then(() => void post(live, { end: true }))
      .finally(() => (ending = undefined));
    return ending;
  }

  /** A report, as JSON; one that fails is ignored. It outlasts the page, which may be leaving. */
  function post(url: string, body: unknown): Promise<unknown> {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => undefined);
  }

  $effect(() => {
    if (!showing || !config.live) return;
    untrack(() => report(refOf(position)));
    const heartbeat = window.setInterval(() => report(refOf(position)), 20_000);
    return () => window.clearInterval(heartbeat);
  });

  /**
   * Start a new session, so a rehearsal's or the last class's answers don't show: its counts from
   * zero, and the phones may answer again. The one control for it: a session also starts by itself
   * after an hour away. The first click asks, the second within a few seconds starts it. The
   * downloads keep every answer all the same.
   */
  let confirming = $state(false);
  let startingSession = $state(false);
  let confirmTimer = 0;
  function newSession() {
    if (!config.live || startingSession) return;
    window.clearTimeout(confirmTimer);
    if (!confirming) {
      confirming = true;
      confirmTimer = window.setTimeout(() => (confirming = false), 4000);
      return;
    }
    confirming = false;
    startingSession = true;
    fetch(config.live, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ restart: true }),
    })
      .catch(() => undefined)
      .finally(() => (startingSession = false));
  }

  function move({ by, delta }: Move) {
    show((by === 'beat' ? step : sceneStep)(current.outline, position, delta), true);
  }

  /** A click in the list: from another scene, Back then returns to where the presenter was. */
  function jump(scene: number, beat: number) {
    const to = { scene, beat };
    if (same(to, position)) return;
    const away = scene !== position.scene;
    const from = formatHash(current.outline, position);
    fromList = away;
    show(to, true, true);
    if (!away) return;
    if (backTo?.scene === scene) back = null;
    else back ??= from;
  }

  function goBack() {
    const to = backTo;
    back = null;
    if (to) show(to, true, true);
  }

  function ownKey(what: PresenterKey) {
    if (what === 'pause') pauseTimer();
    else if (what === 'larger' || what === 'smaller')
      relayout({ notes: noteSize(layout.notes, what === 'larger' ? 1 : -1) });
    else if (what === 'notes-down' || what === 'notes-up')
      scrollNotes(what === 'notes-down' ? 1 : -1);
    else goBack();
  }

  /** A mouse click leaves no focus ring behind; Enter keeps the focus where it is. */
  const blurred = (event: MouseEvent) => {
    if (event.detail > 0) (event.currentTarget as HTMLElement).blur();
  };

  async function present() {
    if (showing) return;
    audience = await openAudience(projectorUrl(config, formatHash(current.outline, position)));
    timer = started(timer, (now = Date.now()));
  }

  function end() {
    stopping.cancel();
    sync.end();
    audience?.close();
    audience = null;
    audienceOpen = false;
    goHome();
  }

  /** Presenting has stopped: back to the deck's page in the app, at this beat. */
  async function goHome() {
    await reportEnd();
    if (config.home) location.replace(`${config.home}${location.hash}`);
  }

  // A closed audience window stops presenting too, unless it was only reloading.
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
    audience?.postMessage(actionMessage('fullscreen'), {
      targetOrigin: location.origin,
      delegate: 'fullscreen',
    } as WindowPostMessageOptions);
  }

  onMount(() => {
    const a = letterbox(currentBox, 'start');
    const b = letterbox(nextBox, 'start');
    current = new Player(a.stage, config.manifest, {
      presenting: true,
      still: true,
      mountAhead: false,
    });
    next = new Player(b.stage, config.manifest, {
      presenting: true,
      still: true,
      mountAhead: true,
    });
    outline = current.outline;
    chapters = current.manifest.chapters;
    title = config.manifest.title;
    const onMessage = (event: MessageEvent) => {
      const introduced = audienceIn(event);
      if (introduced && !introduced.closed) audience = introduced;
    };
    window.addEventListener('message', onMessage);
    sync = joinWindows(config.deck, 'presenter', {
      current: () => refOf(position),
      // Esc in the audience.
      onEnd: goHome,
      onAudience: (open) => {
        audienceOpen = open;
        if (open) timer = started(timer, (now = Date.now()));
      },
      onRefused: () => (fullscreenRefused = true),
      onState: (ref, start) => {
        // A hidden scene too: the deck's page, or the audience, went to it.
        const hash = `#${ref.scene}/${ref.beat}`;
        const to = parseHash(current.outline, hash);
        if (to) show(start ? current.startOf(hash) : to, false);
      },
    });
    // From the deck's page, which may be on a hidden scene: presenting begins at the next one that
    // shows. A window reloaded mid-way hears where the other one is (windows.ts).
    show(current.startOf(location.hash), false);

    const onKey = (event: KeyboardEvent) => {
      const own = presenterKey(event);
      const forNotes =
        own === 'larger' || own === 'smaller' || own === 'notes-down' || own === 'notes-up';
      if (own && (own === 'back' ? backTo : !forNotes || hasNotes)) {
        event.preventDefault();
        ownKey(own);
        return;
      }
      const what = action(event);
      const how = what && moveOf(what);
      if (how) {
        // The speaker moving on: the list follows again, even just after a scroll of it.
        heldUntil = 0;
        event.preventDefault();
        move(how);
      } else if (what === 'present') present();
      // Esc asks once more while presenting, as Stop presenting does.
      else if (what === 'end') showing ? stopping.press('key', end) : end();
      else if (what === 'fullscreen') fullscreen();
    };
    window.addEventListener('keydown', onKey);
    const closed = window.setInterval(() => {
      if (audience?.closed) audience = null;
      now = Date.now();
    }, 500);
    // Back from a lost connection, as after a release restarted the server, which forgot where the
    // presenter is: it hears at once, rather than at the next heartbeat, so the phones' poll opens
    // again within seconds.
    const unlisten =
      config.live && config.events
        ? listen(
            config.events,
            'notes',
            (data) => (notes = JSON.parse(data)),
            () => {
              if (showing) report(refOf(position));
            },
          )
        : undefined;
    const stop = follow(
      config,
      () => [current, next],
      () => {
        outline = current.outline;
        chapters = current.manifest.chapters;
        title = current.manifest.title;
        // The players carried the place across the push, by scene: this window follows them, so
        // the count, the list, the notes and where the phones are told the presenter is match the
        // stage, and the next arrow steps from there.
        show(current.position ?? firstShown(current.outline), false);
      },
    );
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
      window.clearInterval(closed);
      window.clearTimeout(confirmTimer);
      stopping.cancel();
      resetting.cancel();
      stop();
      unlisten?.();
      sync.close();
      current.destroy();
      next.destroy();
    };
  });

  function sceneIndex(chapter: number, scene: number): number {
    let n = 0;
    for (let c = 0; c < chapter; c++) n += chapters[c]!.scenes.length;
    return n + scene;
  }

  const wall = $derived(
    new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  );
</script>

<div
  class="presenter"
  class:dragging-left={dragging === 'left'}
  class:dragging-slide={dragging === 'slide'}
>
  <header>
    <strong>{title}</strong>
    <span class="mono count">{at} / {total}</span>
    {#if (showing || answered) && config.live && hasActivities}
      <span class="mono room">{room}</span>
    {/if}
    <span class="spacer"></span>
    {#if answered && config.live && hasActivities}
      <button class:confirming disabled={startingSession} onclick={newSession}
        >{confirming ? 'Click again to start it' : 'New session'}</button
      >
    {/if}
    {#if showing}
      <!-- Quiet, and it asks once more: ending the talk is the one thing here not to hit by accident. -->
      <button
        class="stop"
        class:confirming={stopping.armed}
        onclick={(event) => {
          stopping.press('click', end);
          blurred(event);
        }}
      >
        <Square size={10} fill="currentColor" aria-hidden="true" />{stopping.armed === 'key'
          ? 'Esc again to stop'
          : stopping.armed
            ? 'Click again to stop'
            : 'Stop presenting'}
      </button>
    {:else}
      <button class="primary" onclick={present}>
        <Play size={12} fill="currentColor" aria-hidden="true" />Present
      </button>
    {/if}
  </header>
  <main bind:this={mainEl} bind:clientWidth={mainWidth} bind:clientHeight={mainHeight}>
    <section class="left" style:width="{sized.left}px">
      <div class="pane" style:height="{sized.pane}px">
        <div class="label now-label" bind:offsetHeight={nowLabel}>
          Now{#if hiddenHere}&nbsp;·&nbsp;<span class="flag"
              >hidden<EyeOff size={11} aria-hidden="true" /></span
            >{/if}
        </div>
        <!-- Showing a hidden scene, the audience sees what is off the plan: Now is framed in red. -->
        <div class="box now" class:off={hiddenHere} bind:this={currentBox}></div>
      </div>
      {#if hasNotes}
        <!-- A window splitter, as WAI-ARIA has it: a separator that takes the focus and moves. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="gutter across"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Slide and notes: drag, or ↑ ↓, to resize; double-click to reset"
          aria-valuenow={Math.round((sized.pane / mainHeight) * 100) || 0}
          tabindex="0"
          title="Drag to resize · double-click to reset"
          onpointerdown={(event) => drag('slide', event)}
          ondblclick={() => relayout({ slide: DEFAULT_LAYOUT.slide })}
          onkeydown={(event) => nudge('slide', event)}
        ></div>
        <div class="notes-col">
          <div class="notes-head">
            <div class="label">Notes</div>
            <span class="spacer"></span>
            {#if notesBelow}
              <span class="more-cue"
                >▼ {notesBelow > 1 ? `${notesBelow} more` : 'more'} · Shift ↓</span
              >
            {/if}
            <button
              class="ctl"
              title="Smaller notes (−)"
              aria-label="Smaller notes"
              disabled={layout.notes <= NOTE_SIZES[0]!}
              onclick={(event) => {
                ownKey('smaller');
                blurred(event);
              }}><AArrowDown size={15} aria-hidden="true" /></button
            >
            <button
              class="ctl"
              title="Larger notes (+)"
              aria-label="Larger notes"
              disabled={layout.notes >= NOTE_SIZES.at(-1)!}
              onclick={(event) => {
                ownKey('larger');
                blurred(event);
              }}><AArrowUp size={15} aria-hidden="true" /></button
            >
          </div>
          <!-- The notes of this scene, as written on the deck's page: the speaker's notes. -->
          <div
            class="notes"
            class:more={notesBelow > 0}
            class:above={notesAbove}
            style:font-size="{layout.notes}px"
            aria-label="Speaker notes"
            bind:this={notesEl}
            onscroll={measureNotes}
          >
            {#each notesHere as note, i (i)}<p>{note}</p>{:else}<p class="none">
                No notes for this scene.
              </p>{/each}
          </div>
        </div>
      {/if}
    </section>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
    <div
      class="gutter along"
      role="separator"
      aria-orientation="vertical"
      aria-label="Columns: drag, or ← →, to resize; double-click to reset"
      aria-valuenow={Math.round(((sized.left + GUTTER / 2) / mainWidth) * 100) || 0}
      tabindex="0"
      title="Drag to resize · double-click to reset"
      onpointerdown={(event) => drag('left', event)}
      ondblclick={() => relayout({ left: DEFAULT_LAYOUT.left })}
      onkeydown={(event) => nudge('left', event)}
    ></div>
    <aside>
      <!-- The timer is the one large number; the clock is smaller beside it. -->
      <div class="time" class:paused={timer.paused}>
        <div class="elapsed-block">
          <div class="label">
            {#if resetting.armed}<span class="flag">Click again to reset</span>{:else}Elapsed{/if}
          </div>
          <div class="row">
            <span class="elapsed">{duration(elapsed)}</span>
            <span class="ctls">
              <button
                class="ctl"
                class:on={timer.paused}
                title={timer.paused ? 'Resume the timer (P)' : 'Pause the timer (P)'}
                aria-label={timer.paused ? 'Resume the timer' : 'Pause the timer'}
                onclick={(event) => {
                  pauseTimer();
                  blurred(event);
                }}
                >{#if timer.paused}<Play
                    size={12}
                    fill="currentColor"
                    aria-hidden="true"
                  />{:else}<Pause size={12} fill="currentColor" aria-hidden="true" />{/if}</button
              >
              <button
                class="ctl"
                class:confirming={resetting.armed}
                title={resetting.armed
                  ? 'Click again to reset the timer to 0:00'
                  : 'Reset the timer to 0:00'}
                aria-label={resetting.armed ? 'Click again to reset the timer' : 'Reset the timer'}
                onclick={(event) => {
                  resetting.press('click', () => (timer = reset(timer, (now = Date.now()))));
                  blurred(event);
                }}><RotateCcw size={13} aria-hidden="true" /></button
              >
            </span>
            {#if timer.paused}<span class="paused-word">Paused</span>{/if}
          </div>
        </div>
        <div class="clock-block">
          <div class="label">Clock</div>
          <div class="clock">{wall}</div>
        </div>
      </div>
      <div class="next-head">
        <div class="label">{atEnd ? 'Next: the end of the deck' : 'Next'}</div>
        <span class="spacer"></span>
        {#if backTo}
          <button
            class="back"
            title={`Back to ${backTo.scene + 1} · ${scenes[backTo.scene]?.title ?? ''} (Backspace)`}
            onclick={goBack}>↩ Back to {backTo.scene + 1}</button
          >
        {/if}
      </div>
      <div
        class="box next"
        class:end={atEnd}
        style:max-width="{sized.next}px"
        bind:this={nextBox}
      ></div>
      <nav
        aria-label="Scenes"
        class:more={moreScenes}
        bind:this={nav}
        onscroll={measureList}
        onwheel={() => (heldUntil = Date.now() + 4000)}
      >
        {#each chapters as chapter, c (chapter.id)}
          <!-- Each chapter's heading stays at the top while its scenes scroll, until the next one's
               pushes it out. A deck with no chapters has its scenes in one with no title: no
               heading. -->
          <section class:here={chapterHere === c}>
            {#if chapter.title}<h3>{chapter.title}</h3>{/if}
            <ol>
              {#each chapter.scenes as scene, s (scene.id)}
                {@const index = sceneIndex(c, s)}
                <!-- A hidden scene is listed, dimmed: presenting steps over it, a click shows it. -->
                <li
                  class:current={index === position.scene}
                  class:hidden={scene.hidden}
                  class:done={index !== position.scene && seen.has(scene.id)}
                  aria-current={index === position.scene ? 'step' : undefined}
                >
                  <button
                    class="scene"
                    title={scene.hidden ? `${scene.title} (hidden)` : scene.title}
                    onclick={(event) => {
                      jump(index, 0);
                      blurred(event);
                    }}
                    ><span class="number" style:min-width="{digits}ch">{index + 1}</span><span
                      class="title">{scene.title}</span
                    >{#if scene.hidden}<EyeOff
                        size={12}
                        class="eye"
                        aria-label="hidden"
                      />{/if}</button
                  >
                  <span class="beats" class:one={scene.beats.length < 2}>
                    {#each scene.beats as beat, b (beat)}
                      {@const here = index === position.scene && b === position.beat}
                      <button
                        class="beat"
                        class:current={here}
                        class:shown={index === position.scene && b < position.beat}
                        title={beat}
                        aria-label={`${scene.title}: ${beat}`}
                        aria-current={here ? 'step' : undefined}
                        onclick={(event) => {
                          jump(index, b);
                          blurred(event);
                        }}
                      ></button>
                    {/each}
                  </span>
                </li>
              {/each}
            </ol>
          </section>
        {/each}
      </nav>
    </aside>
  </main>
  <footer>
    → / Space next · ← previous · ↓ ↑ scene{#if backTo}&nbsp;· <span class="lit"
        >Backspace ↩ back to {backTo.scene + 1}</span
      >{/if} · P pause timer{#if hasNotes}&nbsp;· + / − notes size · Shift ↓ ↑ scroll notes{/if}
    · {#if audience && !fullscreenRefused}F fullscreen · Esc stop{:else if showing}click the
      audience for fullscreen · Esc stop{:else}⌘/Ctrl-Enter present{/if}
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
    gap: 12px;
    padding: 12px 20px;
    box-sizing: border-box;
    background: var(--ink);
    color: #fff;
    font:
      300 14px/1.4 'Tobos Sans',
      system-ui,
      sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .dragging-left,
  .dragging-left :global(*) {
    cursor: col-resize !important;
    user-select: none;
  }
  .dragging-slide,
  .dragging-slide :global(*) {
    cursor: row-resize !important;
    user-select: none;
  }
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding-bottom: 12px;
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
  .count {
    color: #fff;
  }
  .spacer {
    flex: 1;
  }
  header button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
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
    white-space: nowrap;
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
  /* Stop: quiet, and as wide as what it says when it asks, so it doesn't jump. */
  header button.stop {
    box-sizing: border-box;
    width: 216px;
    justify-content: center;
    border-color: var(--line);
    color: var(--grey);
  }
  header button.stop:hover {
    border-color: #fff;
    background: transparent;
    color: #fff;
  }
  header button.stop.confirming {
    border-color: var(--pop);
    background: transparent;
    color: #fff;
  }
  header button:focus-visible,
  .ctl:focus-visible,
  .back:focus-visible,
  .gutter:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  main {
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .left,
  aside,
  .pane,
  .notes-col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .left,
  .pane {
    flex: none;
  }
  aside,
  .notes-col {
    flex: 1;
  }
  /* A caption in brackets, as on tobos.ai: [ NOW ] */
  .label {
    flex: none;
    margin-bottom: 8px;
    font-size: 10.5px;
    font-weight: 500;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .label::before {
    content: '[ ';
  }
  .label::after {
    content: ' ]';
  }
  .label :global(svg) {
    vertical-align: -1px;
    margin-left: 4px;
  }
  .flag {
    color: var(--pop);
  }
  /* A letterbox: the slides sit on the ground, under their labels, not in black bars. */
  .box {
    box-sizing: border-box;
    background: transparent;
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  /* A hairline round each slide, so a dark one doesn't melt into the ground; red round a hidden one. */
  .box :global(.tobos-stage::after) {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 2147483647;
    pointer-events: none;
    box-shadow: inset 0 0 0 calc(1px / var(--tobos-scale, 1)) rgba(255, 255, 255, 0.28);
  }
  .box.now.off :global(.tobos-stage::after) {
    box-shadow: inset 0 0 0 calc(3px / var(--tobos-scale, 1)) var(--pop);
  }
  .box.next {
    flex: none;
    width: 100%;
    aspect-ratio: 16 / 9;
  }
  /* The end of the deck: an empty frame where the next slide would be. */
  .box.next.end {
    border: 1px dashed var(--line);
  }
  .box.next.end :global(.tobos-stage) {
    visibility: hidden;
  }

  /* Dividers: drag to resize, double-click to reset; a grip in the middle says they move. */
  .gutter {
    flex: none;
    position: relative;
    z-index: 2;
  }
  .gutter.along {
    width: 18px;
    cursor: col-resize;
  }
  .gutter.across {
    height: 18px;
    cursor: row-resize;
  }
  .gutter::after,
  .gutter::before {
    content: '';
    position: absolute;
    transition: background 0.15s;
  }
  .gutter::after {
    background: var(--line);
  }
  .gutter.along::after {
    left: 8px;
    width: 2px;
    top: 0;
    bottom: 0;
  }
  .gutter.across::after {
    top: 8px;
    height: 2px;
    left: 0;
    right: 0;
  }
  .gutter::before {
    border-radius: 2px;
    background: var(--grey);
    opacity: 0.6;
  }
  .gutter.along::before {
    left: 6px;
    width: 6px;
    height: 28px;
    top: calc(50% - 14px);
  }
  .gutter.across::before {
    top: 6px;
    height: 6px;
    width: 28px;
    left: calc(50% - 14px);
  }
  .gutter:hover::after,
  .dragging-left .gutter.along::after,
  .dragging-slide .gutter.across::after {
    background: #fff;
  }
  .gutter:hover::before,
  .dragging-left .gutter.along::before,
  .dragging-slide .gutter.across::before {
    background: #fff;
    opacity: 1;
  }

  /* Notes */
  .notes-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .notes-head .label {
    margin: 0;
  }
  .more-cue {
    margin-right: 12px;
    font:
      500 14px 'Tobos Mono',
      ui-monospace,
      monospace;
    color: #fff;
  }
  .notes {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin-top: 8px;
    padding-bottom: 1.2em;
    font-weight: 400;
    line-height: 1.5;
  }
  .notes p {
    margin: 0 0 0.6em;
    white-space: pre-line;
  }
  .notes p.none {
    color: var(--grey);
  }
  /* More below: the last lines fade, so a cut line doesn't read as the end; more above, the first. */
  .notes.more {
    mask-image: linear-gradient(to bottom, #000 calc(100% - 1.2em), transparent);
  }
  .notes.above {
    mask-image: linear-gradient(to bottom, transparent, #000 1.2em);
  }
  .notes.above.more {
    mask-image: linear-gradient(
      to bottom,
      transparent,
      #000 1.2em,
      #000 calc(100% - 1.2em),
      transparent
    );
  }

  /* Small square controls: the timer's and the notes' size. */
  .ctl {
    all: unset;
    box-sizing: border-box;
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 1px solid var(--line);
    color: var(--grey);
    cursor: pointer;
  }
  .ctl:hover {
    border-color: #fff;
    color: #fff;
  }
  .ctl:disabled {
    opacity: 0.35;
    border-color: var(--line);
    color: var(--grey);
    cursor: default;
  }
  .ctl.on {
    border-color: var(--pop);
    background: var(--pop);
    color: #fff;
  }
  .ctl.confirming {
    border-color: var(--pop);
    color: var(--pop);
  }

  /* Time: the digits scale with the column, so they and their buttons fit however narrow it gets. */
  .time {
    flex: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 14px;
    container-type: inline-size;
  }
  .elapsed-block {
    min-width: 0;
  }
  .elapsed-block .label {
    margin-bottom: 6px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .ctls {
    display: flex;
    flex: none;
    gap: 6px;
  }
  .elapsed {
    min-width: 5ch;
    font:
      400 clamp(32px, 12cqi, 52px) / 1 'Tobos Mono',
      ui-monospace,
      monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }
  /* Paused: the digits dim and hold still; the red button and the word say why. */
  .time.paused .elapsed {
    opacity: 0.45;
  }
  .paused-word {
    font:
      500 16px 'Tobos Mono',
      ui-monospace,
      monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--pop);
  }
  .clock-block {
    flex: none;
    text-align: right;
  }
  .clock {
    font:
      300 clamp(18px, 7cqi, 34px) / 1 'Tobos Mono',
      ui-monospace,
      monospace;
    font-variant-numeric: tabular-nums;
    color: #c9cdd6;
  }

  /* Next, and the way back after a jump. */
  .next-head {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    min-height: 26px;
    margin-bottom: 4px;
  }
  .next-head .label {
    margin: 0;
  }
  .back {
    all: unset;
    flex: none;
    padding: 6px 12px;
    border: 1px solid var(--pop);
    color: #fff;
    font:
      500 13px 'Tobos Mono',
      ui-monospace,
      monospace;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
  }
  .back:hover {
    background: var(--pop);
  }

  /* The scenes */
  nav {
    position: relative;
    flex: 1;
    min-height: 150px;
    margin-top: 14px;
    padding-bottom: 30%;
    overflow: auto;
  }
  nav.more {
    mask-image: linear-gradient(to bottom, #000 calc(100% - 32px), transparent);
  }
  h3 {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: 12px 0 6px;
    background: var(--ink);
    font-size: 12px;
    font-weight: 500;
    color: var(--grey);
  }
  section:first-child h3 {
    padding-top: 0;
  }
  section.here h3 {
    color: #fff;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-left: 2px solid transparent;
    transition: background 0.12s;
  }
  li:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  li.current {
    border-left-color: #fff;
    background: rgba(255, 255, 255, 0.13);
  }
  li.current:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  /* The whole row is the scene's button; its beats sit above it. */
  .scene {
    all: unset;
    flex: 0 1 auto;
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    cursor: pointer;
  }
  .scene::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .title {
    overflow: hidden;
    font-size: 15px;
    font-weight: 400;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  li.current .title {
    white-space: normal;
  }
  li:hover .title {
    color: #fff;
  }
  li.done .title {
    color: var(--grey);
  }
  /* Hidden, as the deck's page has it: the number kept, the title faded, a crossed-out eye after
     it; fainter than done, unless it is on stage. */
  li.hidden .title {
    color: var(--grey);
  }
  li.hidden:not(.current) {
    opacity: 0.5;
  }
  .scene :global(.eye) {
    flex: none;
    align-self: center;
    color: var(--grey);
  }
  .number {
    display: inline-block;
    margin-right: 2px;
    text-align: right;
    font-family: 'Tobos Mono', ui-monospace, monospace;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--grey);
  }
  .scene:focus-visible,
  .beat:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
  }
  /* Beats: a larger target than the dot; the one on stage the largest. One beat has none. */
  .beats {
    position: relative;
    display: flex;
    margin-left: 4px;
  }
  .beats.one {
    visibility: hidden;
  }
  .beat {
    all: unset;
    width: 18px;
    height: 18px;
    padding: 5px;
    border-radius: 50%;
    box-sizing: border-box;
    background-clip: content-box;
    background-color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
  }
  li:not(.current) .beat {
    background-color: rgba(255, 255, 255, 0.2);
  }
  .beat.shown {
    background-color: rgba(255, 255, 255, 0.6);
  }
  .beat:hover {
    background-color: #fff;
  }
  .beat.current {
    padding: 3px;
    background-color: #fff;
  }
  footer {
    font-size: 11px;
  }
  footer .lit {
    color: #fff;
  }
</style>
