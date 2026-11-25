<script lang="ts">
  import AArrowDown from '@lucide/svelte/icons/a-arrow-down';
  import AArrowUp from '@lucide/svelte/icons/a-arrow-up';
  import EyeOff from '@lucide/svelte/icons/eye-off';
  import Pause from '@lucide/svelte/icons/pause';
  import Play from '@lucide/svelte/icons/play';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Square from '@lucide/svelte/icons/square';
  import Undo2 from '@lucide/svelte/icons/undo-2';
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
    loadAnimate,
    loadLayout,
    noteSize,
    NOTE_SIZES,
    saveAnimate,
    saveLayout,
    type Layout,
  } from './layout.ts';
  import { follow } from './live.ts';
  import { listen } from './events.ts';
  import { Player } from './player.ts';
  import { audienceIn, openAudience } from './screens.ts';
  import SparklesOff from './SparklesOff.svelte';
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
  /**
   * Whether the audience plays the animations, or lands each step on its end state; this browser
   * remembers it, as it does the layout. This view's own slides never animate either way.
   */
  let animate = $state(loadAnimate(storage()));
  function toggleAnimate() {
    animate = !animate;
    sync.animate(animate);
    saveAnimate(storage(), animate);
  }

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

  /**
   * The layout a divider sets, put at `at` of `size`: the columns' sets the width, and the slide
   * fills it; the slide's sets the slide's height, and the column widens or narrows to it. Either
   * way the slide fills its column, and the divider stays where it was put.
   */
  const dividerAt = {
    left: (at: number, size: number): Partial<Layout> => ({ left: dragLeft(at, size), slide: 1 }),
    slide: (at: number, size: number): Partial<Layout> => ({ slide: dragSlide(at, size), left: 0 }),
  };
  /** A double click on either divider fits both again, as each drag let go of the other. */
  const fitAgain = () => relayout({ left: DEFAULT_LAYOUT.left, slide: DEFAULT_LAYOUT.slide });

  /**
   * A divider follows the pointer while it is down, once a frame however often the pointer moves,
   * as each move lays both slides out again; a double click puts it back.
   */
  function drag(which: 'left' | 'slide', event: PointerEvent) {
    const gutter = event.currentTarget as HTMLElement;
    const across = which === 'left';
    const area = (across ? mainEl : gutter.parentElement!).getBoundingClientRect();
    const own = gutter.getBoundingClientRect();
    // Where on the divider it was taken hold of, so it doesn't jump to put its middle there.
    const held = across
      ? event.clientX - own.left - own.width / 2
      : event.clientY - own.top - own.height / 2;
    gutter.setPointerCapture(event.pointerId);
    dragging = which;
    let frame = 0;
    let latest = event;
    const place = (e: PointerEvent) => {
      const change = across
        ? dividerAt.left(e.clientX - held - area.left, area.width)
        : dividerAt.slide(e.clientY - held - area.top, area.height);
      layout = { ...layout, ...change };
    };
    const onMove = (e: PointerEvent) => {
      latest = e;
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        place(latest);
      });
    };
    const onUp = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      // Where it was let go, the frame not yet drawn; a click without a move changes nothing.
      if (latest !== event) place(latest);
      dragging = null;
      // A click on a divider focuses it; the arrows go back to the stage once it is let go.
      gutter.blur();
      saveLayout(storage(), layout);
      gutter.removeEventListener('pointermove', onMove);
      gutter.removeEventListener('lostpointercapture', onUp);
    };
    gutter.addEventListener('pointermove', onMove);
    // Let go, cancelled, or the capture lost any other way: the drag ends.
    gutter.addEventListener('lostpointercapture', onUp);
  }

  /** By keyboard, a divider in focus moves with its arrows, not the stage. */
  function nudge(which: 'left' | 'slide', event: KeyboardEvent) {
    const by = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    if (which === 'left')
      relayout(dividerAt.left(sized.left + GUTTER / 2 + by * 0.02 * mainWidth, mainWidth));
    else relayout(dividerAt.slide(sized.pane + GUTTER / 2 + by * 0.02 * mainHeight, mainHeight));
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
    else if (what === 'animations') toggleAnimate();
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
      skeleton: true,
    });
    next = new Player(b.stage, config.manifest, {
      presenting: true,
      still: true,
      mountAhead: true,
      skeleton: true,
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
      animating: () => animate,
      onState: (ref, start) => {
        // A hidden scene too: the deck's page, or the audience, went to it.
        const hash = `#${ref.scene}/${ref.beat}`;
        const to = parseHash(current.outline, hash);
        if (to) show(start ? current.startOf(hash) : to, false);
      },
    });
    // An audience already open, reloaded with this view, plays the animations as this one says.
    sync.animate(animate);
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
      else if (what === 'end') end();
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

<!-- The chrome's parts are each marked .tobos-chrome on-ink: tobos.ai's tokens and classes, turned
     over for the dark ground, reach inside them (chrome-style.ts). None of them holds a slide, so a
     deck's scenes inherit none of it. -->
<div
  class="presenter"
  class:dragging-left={dragging === 'left'}
  class:dragging-slide={dragging === 'slide'}
>
  <header class="tobos-chrome on-ink">
    <strong>{title}</strong>
    <span class="mono at">{at} / {total}</span>
    {#if (showing || answered) && config.live && hasActivities}
      <span class="mono">{room}</span>
    {/if}
    <span class="spacer"></span>
    {#if answered && config.live && hasActivities}
      <!-- Asking again, a button is edged in red: the label says what the next click does. -->
      <button class="btn" class:armed={confirming} disabled={startingSession} onclick={newSession}
        >{confirming ? 'Click again to start it' : 'New session'}</button
      >
    {/if}
    {#if showing}
      <!-- Quiet, and a click asks once more: ending the talk is the one thing here not to hit by
           accident. Esc ends it at once. -->
      <button
        class="btn btn-quiet stop"
        class:armed={stopping.armed}
        onclick={(event) => {
          stopping.press(end);
          blurred(event);
        }}
      >
        <Square size={12} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />{stopping.armed
          ? 'Click again to stop'
          : 'Stop presenting'}
      </button>
    {:else}
      <button class="btn btn-primary" onclick={present}>
        <Play size={12} strokeWidth={1.5} fill="currentColor" aria-hidden="true" />Present
      </button>
    {/if}
  </header>
  <main bind:this={mainEl} bind:clientWidth={mainWidth} bind:clientHeight={mainHeight}>
    <section class="left" style:width="{sized.left}px">
      <div class="pane" style:height="{sized.pane}px">
        <div class="tobos-chrome on-ink now-label" bind:offsetHeight={nowLabel}>
          <span class="cap"
            >Now{#if hiddenHere}&nbsp;·&nbsp;<span class="flag"
                >hidden<EyeOff size={12} strokeWidth={1.5} aria-hidden="true" /></span
              >{/if}{#if !animate}&nbsp;·&nbsp;<span class="flag"
                >no animations<SparklesOff size={12} strokeWidth={1.5} aria-hidden="true" /></span
              >{/if}</span
          >
          <!-- The audience's animations: at the right of the caption over what the audience sees,
               as the notes' sizes are over the notes. Off, the caption says so. -->
          <span class="spacer"></span>
          <button
            class="btn btn-quiet btn-icon"
            aria-pressed={animate}
            aria-label="Animations"
            title={`Turn the audience's animations ${animate ? 'off' : 'on'} (A)`}
            onclick={(event) => {
              toggleAnimate();
              blurred(event);
            }}
            >{#if animate}<Sparkles
                size={16}
                strokeWidth={1.5}
                aria-hidden="true"
              />{:else}<SparklesOff size={16} strokeWidth={1.5} aria-hidden="true" />{/if}</button
          >
        </div>
        <!-- Showing a hidden scene, the audience sees what is off the plan: Now is framed in red. -->
        <div class="box now" class:off={hiddenHere} bind:this={currentBox}></div>
      </div>
      {#if hasNotes}
        <!-- A window splitter, as WAI-ARIA has it: a separator that takes the focus and moves. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <div
          class="tobos-chrome on-ink gutter across"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Slide and notes: drag, or ↑ ↓, to resize; double-click to reset"
          aria-valuenow={Math.round((sized.pane / mainHeight) * 100) || 0}
          tabindex="0"
          title="Drag to resize · double-click to reset"
          onpointerdown={(event) => drag('slide', event)}
          ondblclick={fitAgain}
          onkeydown={(event) => nudge('slide', event)}
        ></div>
        <div class="tobos-chrome on-ink notes-col">
          <div class="notes-head">
            <span class="cap">Notes</span>
            <span class="spacer"></span>
            {#if notesBelow}
              <span class="more-cue"
                >▼ {notesBelow > 1 ? `${notesBelow} more` : 'more'} · Shift ↓</span
              >
            {/if}
            <button
              class="btn btn-quiet btn-icon"
              title="Smaller notes (−)"
              aria-label="Smaller notes"
              disabled={layout.notes <= NOTE_SIZES[0]!}
              onclick={(event) => {
                ownKey('smaller');
                blurred(event);
              }}><AArrowDown size={16} strokeWidth={1.5} aria-hidden="true" /></button
            >
            <button
              class="btn btn-quiet btn-icon"
              title="Larger notes (+)"
              aria-label="Larger notes"
              disabled={layout.notes >= NOTE_SIZES.at(-1)!}
              onclick={(event) => {
                ownKey('larger');
                blurred(event);
              }}><AArrowUp size={16} strokeWidth={1.5} aria-hidden="true" /></button
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
      class="tobos-chrome on-ink gutter along"
      role="separator"
      aria-orientation="vertical"
      aria-label="Columns: drag, or ← →, to resize; double-click to reset"
      aria-valuenow={Math.round(((sized.left + GUTTER / 2) / mainWidth) * 100) || 0}
      tabindex="0"
      title="Drag to resize · double-click to reset"
      onpointerdown={(event) => drag('left', event)}
      ondblclick={fitAgain}
      onkeydown={(event) => nudge('left', event)}
    ></div>
    <aside>
      <!-- The timer is the one large number; the clock is smaller beside it. -->
      <div class="tobos-chrome on-ink time" class:paused={timer.paused}>
        <div class="elapsed-block">
          <div class="cap label">
            {#if resetting.armed}<span class="flag">Click again to reset</span>{:else}Elapsed{/if}
          </div>
          <div class="time-row">
            <span class="elapsed">{duration(elapsed)}</span>
            <span class="ctls">
              <!-- Paused, the way on is an ink outline, not a hairline: the one to press. -->
              <button
                class="btn btn-icon"
                class:btn-quiet={!timer.paused}
                title={timer.paused ? 'Resume the timer (P)' : 'Pause the timer (P)'}
                aria-label={timer.paused ? 'Resume the timer' : 'Pause the timer'}
                onclick={(event) => {
                  pauseTimer();
                  blurred(event);
                }}
                >{#if timer.paused}<Play
                    size={16}
                    strokeWidth={1.5}
                    fill="currentColor"
                    aria-hidden="true"
                  />{:else}<Pause
                    size={16}
                    strokeWidth={1.5}
                    fill="currentColor"
                    aria-hidden="true"
                  />{/if}</button
              >
              <button
                class="btn btn-quiet btn-icon"
                class:armed={resetting.armed}
                title={resetting.armed
                  ? 'Click again to reset the timer to 0:00'
                  : 'Reset the timer to 0:00'}
                aria-label={resetting.armed ? 'Click again to reset the timer' : 'Reset the timer'}
                onclick={(event) => {
                  resetting.press(() => (timer = reset(timer, (now = Date.now()))));
                  blurred(event);
                }}><RotateCcw size={16} strokeWidth={1.5} aria-hidden="true" /></button
              >
            </span>
            {#if timer.paused}<span class="paused-word"
                ><span class="dot dot-pop" aria-hidden="true"></span>Paused</span
              >{/if}
          </div>
        </div>
        <div class="clock-block">
          <div class="cap label">Clock</div>
          <div class="clock">{wall}</div>
        </div>
      </div>
      <div class="tobos-chrome on-ink next-head">
        <span class="cap">{atEnd ? 'Next: the end of the deck' : 'Next'}</span>
        <span class="spacer"></span>
        {#if backTo}
          <button
            class="btn"
            title={`Back to ${backTo.scene + 1} · ${scenes[backTo.scene]?.title ?? ''} (Backspace)`}
            onclick={goBack}
            ><Undo2 size={16} strokeWidth={1.5} aria-hidden="true" />Back to {backTo.scene +
              1}</button
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
        class="tobos-chrome on-ink"
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
                    ><span class="count" style:min-width="{digits}ch">{index + 1}</span><span
                      class="scene-title">{scene.title}</span
                    >{#if scene.hidden}<EyeOff
                        size={12}
                        strokeWidth={1.5}
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
  <footer class="tobos-chrome on-ink">
    <!-- Each hint whole on its line: a narrow window breaks the list only between them. -->
    <span>→ / Space next</span> · <span>← previous</span> ·
    <span>↓ ↑ scene</span>{#if backTo}&nbsp;· <span class="lit"
        >Backspace back to {backTo.scene + 1}</span
      >{/if} ·
    <span>P pause timer</span> · <span>A animations</span>{#if hasNotes}&nbsp;·
      <span>+ / − notes size</span> · <span>Shift ↓ ↑ scroll notes</span>{/if}
    · {#if audience && !fullscreenRefused}<span>F fullscreen</span> ·
      <span>Esc stop</span>{:else if showing}<span>click the audience for fullscreen</span> ·
      <span>Esc stop</span>{:else}<span>⌘/Ctrl-Enter present</span>{/if}
  </footer>
</div>

<style>
  /* Dark, so the slides are what you look at: tobos.ai's look turned over (.on-ink), its faces,
     and its one red, kept for what needs the speaker. The ground is written out here, as the tokens are set only
     on the chrome's parts (chrome-style.ts), never round a slide. */
  .presenter {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 12px;
    padding: 12px 20px;
    box-sizing: border-box;
    background: #121a2c;
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
    gap: var(--s6);
    padding-bottom: var(--s3);
    border-bottom: 1px solid var(--line);
  }
  header strong {
    font: 400 var(--text-read) / 1.4 var(--sans);
  }
  .mono {
    flex: none;
    color: var(--ink-2);
    font: 400 var(--text-small) / 1 var(--mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .at {
    color: var(--ink);
  }
  .spacer {
    flex: 1;
  }
  /* Asking once more: dark, edged with the 2px red mark, under the pointer too, so it never reads
     as the filled Present beside it; the label says what the next click does. */
  .btn.armed,
  .btn.armed:not(:disabled):hover {
    border-color: var(--pop);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--pop);
    color: var(--ink);
  }
  /* Stop: quiet, and as wide as what it says when it asks, so it doesn't jump. */
  .stop {
    width: 216px;
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
  .now-label,
  .label {
    flex: none;
    margin-bottom: var(--s2);
    white-space: nowrap;
  }
  /* A block, so the Now caption's row is as tall as Elapsed's and Clock's beside it; in a narrow
     column, cut short rather than run under the switch. */
  .now-label .cap {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cap :global(svg) {
    vertical-align: -2px;
    margin-left: var(--s1);
  }
  /* What a caption flags (hidden, asking again) is in ink; the red mark is elsewhere: the frame
     round a hidden scene, the edge of the button that asks again. */
  .flag {
    color: var(--ink);
  }
  /* A letterbox: the slides sit on the ground, under their labels, not in black bars. The tokens
     stop above them, so their values are written out: the ground's line, the red. */
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
    box-shadow: inset 0 0 0 calc(2px / var(--tobos-scale, 1)) #ef4423;
  }
  .box.next {
    flex: none;
    width: 100%;
    aspect-ratio: 16 / 9;
  }
  /* The end of the deck: an empty frame where the next slide would be. */
  .box.next.end {
    border: 1px dashed rgba(255, 255, 255, 0.14);
  }
  .box.next.end :global(.tobos-stage) {
    visibility: hidden;
  }

  /* Dividers: drag to resize, double-click to reset; a grip in the middle says they move. */
  .gutter {
    flex: none;
    position: relative;
    z-index: 2;
    /* Clear, so it never covers the focus ring of a control beside it. */
    background: none;
  }
  .gutter:focus-visible {
    outline: var(--focus);
    outline-offset: var(--focus-offset);
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
    transition: background-color var(--t-ui) var(--ease);
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
    background: var(--ink-3);
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
  .dragging-slide .gutter.across::after,
  .gutter:hover::before,
  .dragging-left .gutter.along::before,
  .dragging-slide .gutter.across::before {
    background: var(--ink);
  }

  /* Notes */
  .now-label,
  .notes-head {
    display: flex;
    align-items: center;
    gap: var(--s2);
  }
  /* The Now caption stays level with Elapsed's and Clock's: the switch (36px) at its right makes
     the row taller below it. */
  .now-label {
    align-items: flex-start;
  }
  .more-cue {
    margin-right: var(--s3);
    color: var(--ink);
    font: 500 var(--text-ui) / 1 var(--mono);
  }
  .notes {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin-top: var(--s2);
    padding-bottom: 1.2em;
    font-weight: 400;
    line-height: 1.5;
  }
  .notes p {
    margin: 0 0 0.6em;
    white-space: pre-line;
  }
  .notes p.none {
    color: var(--ink-2);
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

  /* Time: the digits scale with the column, so they and their buttons fit however narrow it gets. */
  .time {
    flex: none;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--s4);
    padding-bottom: var(--s4);
    container-type: inline-size;
  }
  .elapsed-block {
    min-width: 0;
  }
  .elapsed-block .label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .time-row {
    display: flex;
    align-items: center;
    gap: var(--s3);
  }
  .ctls {
    display: flex;
    flex: none;
    gap: var(--s2);
  }
  .elapsed {
    min-width: 5ch;
    font: 400 clamp(32px, 12cqi, 52px) / 1 var(--mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: var(--track-tight);
  }
  /* Paused: the digits dim and hold still; a red dot and the word say why. */
  .time.paused .elapsed {
    opacity: 0.45;
  }
  .paused-word {
    display: inline-flex;
    align-items: center;
    gap: var(--s2);
    color: var(--ink);
    font: 500 var(--text-ui) / 1 var(--mono);
    letter-spacing: var(--track-mono);
    text-transform: uppercase;
    white-space: nowrap;
  }
  .clock-block {
    flex: none;
    text-align: right;
  }
  .clock {
    color: var(--ink-2);
    font: 300 clamp(18px, 7cqi, 34px) / 1 var(--mono);
    font-variant-numeric: tabular-nums;
  }

  /* Next, and the way back after a jump; as tall as the button, so it doesn't jump when it comes. */
  .next-head {
    display: flex;
    align-items: center;
    gap: var(--s3);
    min-width: 0;
    min-height: var(--control);
    margin-bottom: var(--s1);
  }

  /* The scenes */
  nav {
    position: relative;
    flex: 1;
    min-height: 150px;
    margin-top: var(--s4);
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
    padding: var(--s3) 0 var(--s1);
    background: rgb(var(--sh));
    color: var(--ink-3);
    font: 500 var(--text-small) / 1.4 var(--sans);
  }
  section:first-child h3 {
    padding-top: 0;
  }
  section.here h3 {
    color: var(--ink);
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  /* A row's states, as the app's lists have them: the tint under the pointer, and where you are
     the tint with a mark at its edge, in ink: the presenter keeps its red for what needs the
     speaker (paused, hidden, asking again), one at a time. */
  li {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--s2);
    padding: var(--s1) var(--s2);
    border-left: 2px solid transparent;
    transition: background-color var(--t-ui) var(--ease);
  }
  /* The app's half tint is too faint on the dark ground, the whole one the current row's: two
     thirds. */
  @media (hover: hover) {
    li:hover {
      background: color-mix(in srgb, var(--ink-soft) 65%, transparent);
    }
  }
  li.current {
    border-left-color: var(--ink);
    background: var(--ink-soft);
  }
  /* The whole row is the scene's button; its beats sit above it. */
  .scene {
    all: unset;
    flex: 0 1 auto;
    display: flex;
    align-items: baseline;
    gap: var(--s2);
    min-width: 0;
    cursor: pointer;
  }
  .scene::after {
    content: '';
    position: absolute;
    inset: 0;
  }
  .scene-title {
    overflow: hidden;
    font: 400 var(--text-ui) / 1.4 var(--sans);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  li.current .scene-title {
    white-space: normal;
  }
  li:hover .scene-title {
    color: var(--ink);
  }
  li.done .scene-title {
    color: var(--ink-2);
  }
  /* Hidden, as the deck's page has it: the number kept, the title faded, a crossed-out eye after
     it; fainter than done, unless it is on stage. */
  li.hidden .scene-title {
    color: var(--ink-2);
  }
  li.hidden:not(.current) {
    opacity: 0.5;
  }
  .scene :global(.eye) {
    flex: none;
    align-self: center;
    color: var(--ink-2);
  }
  .count {
    display: inline-block;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .scene:focus-visible {
    outline: var(--focus);
    outline-offset: var(--focus-offset);
  }
  .beat:focus-visible {
    outline: var(--focus);
    outline-offset: -2px;
  }
  /* Beats: dots, a larger target than the dot; the one on stage the largest. One beat has none. */
  .beats {
    position: relative;
    display: flex;
    margin-left: var(--s1);
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
    background-color: var(--ink-3);
    cursor: pointer;
  }
  li:not(.current) .beat {
    background-color: color-mix(in srgb, var(--ink-3) 50%, transparent);
  }
  .beat.shown {
    background-color: var(--ink-2);
  }
  .beat:hover {
    background-color: var(--ink);
  }
  .beat.current {
    padding: 3px;
    background-color: var(--ink);
  }
  footer span {
    white-space: nowrap;
  }
  footer {
    color: var(--ink-3);
    font: 400 var(--text-small) / 1.4 var(--mono);
    font-variant-numeric: tabular-nums;
  }
  footer .lit {
    color: var(--ink);
  }
</style>
