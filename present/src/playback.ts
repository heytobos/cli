/**
 * Video and sound in beats. The scene's timeline is the clock and a clip follows it, so what a
 * video shows depends only on the position, like everything else on the stage, and a sound is
 * heard only while a step forward plays it.
 */
import { gsap } from 'gsap';
import { addSpan, playingAloud, playingForward } from './timeline.ts';

interface ClipOptions {
  /** Where the clip starts in the video or sound, in seconds. Default 0. */
  from?: number;
  /** Where the clip ends in the video or sound, in seconds. Default: its end. */
  to?: number;
  /** Speed: 1 is real time, 0.5 half speed. Default 1. */
  rate?: number;
  /**
   * When the clip starts within the beat: GSAP's position parameter (`'<'`, `'+=0.5'`, a
   * number). Default: after what the beat has animated so far, like any `tl.to`.
   */
  position?: gsap.Position;
}

export interface PlayAudioOptions extends ClipOptions {
  /**
   * The beat the sound plays until. It plays on through the beats before it, whichever way the
   * presenter moves among them, and fades out when this beat or one outside the range is shown,
   * or the scene is left. The beat it starts in doesn't wait for it, and `to` and `position`
   * don't apply: it plays from `from` to its end, or until then.
   */
  until?: string;
  /** With `until`: how long it fades out, in seconds. Default 1; 0 stops it at once. */
  fade?: number;
}

export interface PlayVideoOptions extends ClipOptions {
  /** Play the video's own sound with it. Default: muted. */
  sound?: boolean;
}

/** How far a playing clip may drift from the timeline before it is put back, in seconds. */
const DRIFT = 0.25;

/** Videos whose first clip has set their opening frame. */
const opened = new WeakSet<HTMLVideoElement>();
/** Videos whose play() the browser refused even muted: they follow the timeline by seeking. */
const unplayable = new WeakSet<HTMLVideoElement>();
/** Paused videos whose landing frame is still to be put on screen again (`repaint`). */
const repaints = new WeakMap<HTMLVideoElement, Promise<void>>();
/** Elements that make sound: every `<audio>` played, and videos played with `{ sound: true }`. */
const sounding = new WeakSet<HTMLMediaElement>();
/**
 * Elements the browser wouldn't let make sound in the clip playing now: a sound waits, paused,
 * and a video plays on muted, until a click or key press in this window (`unlock`), or the clip's
 * end.
 */
const refused = new WeakSet<HTMLMediaElement>();
/** Elements a click or key press in this window has played: the browser lets them be heard. */
const unlocked = new WeakSet<HTMLMediaElement>();
/** Each start or stop of an element's clip, counted: a refusal that comes after a stop is stale. */
const turns = new WeakMap<HTMLMediaElement, number>();
/** Who hears that this window was refused sound (`onSoundRefused`). */
const refusals = new Set<() => void>();
/** Sounds fading out, with the volume each had before. */
const fades = new WeakMap<
  HTMLMediaElement,
  { tween: gsap.core.Tween; volume: number; done: () => void; silent: Promise<void> }
>();

/**
 * Play a video (or the clip `from`–`to` of it) as part of a beat. Stepping forward plays it in
 * real time; going back, jumping or reloading shows the frame for that position at once; a
 * click while it plays lands on its last frame. Before its beat it shows the clip's first frame.
 *
 * ```ts
 * { id: 'turn', enter: (tl, q) => playVideo(tl, q('video')) }
 * ```
 *
 * The video plays inline and preloads, and is muted unless `sound` is set. Several videos
 * (`q('video')` finding more than one) play side by side, each its own length.
 */
export function playVideo(
  tl: gsap.core.Timeline,
  target: Element | ArrayLike<Element> | null | undefined,
  options: PlayVideoOptions = {},
): gsap.core.Timeline {
  const videos = elementsIn(target, 'VIDEO') as HTMLVideoElement[];
  if (videos.length === 0) console.warn('[tobos] playVideo found no <video> element');
  return addClips(tl, videos, options, Boolean(options.sound));
}

/**
 * Play a sound (or the clip `from`–`to` of it) as part of a beat. Stepping forward plays it in
 * real time; a click while it plays stops it and plays the next beat; going back, jumping or
 * reloading is silent. So is a scene mounted ahead, and a window that only follows another.
 *
 * ```ts
 * { id: 'listen', enter: (tl, q) => playAudio(tl, q('audio')) }
 * ```
 *
 * The sound preloads. Several (`q('audio')` finding more than one) play together, each its own
 * length.
 */
export function playAudio(
  tl: gsap.core.Timeline,
  target: Element | ArrayLike<Element> | null | undefined,
  options: PlayAudioOptions = {},
): gsap.core.Timeline {
  const sounds = elementsIn(target, 'AUDIO');
  if (sounds.length === 0) console.warn('[tobos] playAudio found no <audio> element');
  if (options.until === undefined) return addClips(tl, sounds, options, true);
  const from = Math.max(0, options.from ?? 0);
  const rate = options.rate !== undefined && options.rate > 0 ? options.rate : 1;
  const fade = Math.max(0, options.fade ?? 1);
  for (const audio of sounds) {
    prepare(audio, true);
    const span = {
      start() {
        unfade(audio);
        // Seeking to the start of a sound that played to its end makes it playable again.
        if (audio.ended || Math.abs(audio.currentTime - from) > 0.0005) audio.currentTime = from;
        audio.playbackRate = rate;
        start(audio);
      },
      stop: (fading: boolean) => silence(audio, fading ? fade : 0),
    };
    if (!addSpan(tl, options.until, span))
      console.warn(
        `[tobos] playAudio: until names "${options.until}", which is not a later beat of this scene`,
      );
  }
  return tl;
}

/**
 * Call `listener` each time the browser refuses this window sound, until a click or key press
 * in it lets it play. Returns a function that stops listening.
 */
export function onSoundRefused(listener: () => void): () => void {
  refusals.add(listener);
  return () => refusals.delete(listener);
}

function addClips(
  tl: gsap.core.Timeline,
  elements: HTMLMediaElement[],
  options: PlayAudioOptions,
  sound: boolean,
): gsap.core.Timeline {
  elements.forEach((element, i) => {
    prepare(element, sound);
    const from = Math.max(0, options.from ?? 0);
    const to = options.to ?? element.duration;
    const rate = options.rate !== undefined && options.rate > 0 ? options.rate : 1;
    if (!Number.isFinite(to))
      console.warn(
        `[tobos] ${isVideo(element) ? 'playVideo' : 'playAudio'}: the ${isVideo(element) ? 'video' : 'sound'}'s length isn't known (has it loaded?); pass { to } in seconds`,
      );
    const duration = Number.isFinite(to) ? Math.abs(to - from) / rate : 0;
    if (isVideo(element) && !opened.has(element)) {
      opened.add(element);
      land(element, from);
    }

    // GSAP calls a function-valued property as a setter on every render, seek or play, with
    // events suppressed or not. Its value is the clip's progress, 0..1.
    let progress = 0;
    const clip = {
      progress(value?: number): number {
        if (value === undefined) return progress;
        progress = value;
        const end = Number.isFinite(to) ? to : element.duration;
        if (!Number.isFinite(end)) return progress;
        const time = from + (end - from) * value;
        const playing = value < 1 && end > from && playingForward(tween);
        const heard = sound && playing && playingAloud(tween);
        if (isVideo(element)) follow(element, time, playing, heard, rate);
        else followSound(element, time, heard, rate);
        return progress;
      },
    };
    const tween = gsap.fromTo(
      clip,
      { progress: 0 },
      { progress: 1, duration, ease: 'none', immediateRender: false },
    );
    tl.add(tween, i === 0 ? options.position : '<');
  });
  return tl;
}

function elementsIn(
  target: Element | ArrayLike<Element> | null | undefined,
  tag: 'VIDEO' | 'AUDIO',
): HTMLMediaElement[] {
  if (!target) return [];
  const list = 'length' in target ? Array.from(target) : [target as Element];
  return list.filter((el): el is HTMLMediaElement => el?.tagName === tag);
}

const isVideo = (element: HTMLMediaElement): element is HTMLVideoElement =>
  element.tagName === 'VIDEO';

/** Inline, preloading and paused, muted unless it makes sound: the timeline starts and stops it. */
function prepare(element: HTMLMediaElement, sound: boolean) {
  element.muted = !sound;
  element.defaultMuted = !sound;
  if (isVideo(element)) element.setAttribute('playsinline', '');
  element.autoplay = false;
  element.loop = false;
  if (element.preload !== 'auto') element.preload = 'auto';
  if (!element.paused) element.pause();
  if (sound) {
    sounding.add(element);
    listenForGestures();
  }
}

/**
 * Bring the video to `time`. While the timeline plays forward, the video plays itself and is
 * only put back if it drifts; otherwise it is paused on the frame for `time`. `heard`: with its
 * sound.
 *
 * Why not seek on every frame: a seek decodes from the keyframe before it, and a new seek
 * abandons the one in flight. Measured in headless Chromium, 3 s of a 1080p clip with a
 * keyframe every 4 s: seeking every animation frame drew no frame at all, play() drew all 90.
 * A light 720p clip still showed gaps of 100–130 ms when seeking, 34 ms when playing.
 */
function follow(
  video: HTMLVideoElement,
  time: number,
  playing: boolean,
  heard: boolean,
  rate: number,
) {
  if (playing && !unplayable.has(video) && !video.ended) {
    if (video.paused) {
      seek(video, time);
      video.playbackRate = rate;
      video.muted = !heard || refused.has(video);
      start(video);
    } else if (!video.seeking && Math.abs(video.currentTime - time) > DRIFT) {
      seek(video, time);
    }
    return;
  }
  stopped(video);
  // A video stopped a hair before `time` shows the frame before it where `time` is a frame's
  // first instant (a clip ending at a whole second), so a stop from playing lands exactly.
  const stopping = !video.paused;
  if (stopping) video.pause();
  land(video, time, stopping ? 0 : undefined);
}

/**
 * Bring a sound to `time`: while it is heard, it plays itself and is only put back if it drifts;
 * otherwise it is paused, wherever it is, since nothing shows where. The next clip seeks.
 */
function followSound(audio: HTMLMediaElement, time: number, heard: boolean, rate: number) {
  if (!heard) {
    stopped(audio);
    if (!audio.paused) audio.pause();
    return;
  }
  // Waiting for a click or key press (unlock).
  if (refused.has(audio)) return;
  if (audio.paused) {
    // Played to its end a moment before the timeline got there: nothing of the clip is left.
    if (audio.ended && time > audio.duration - DRIFT) return;
    seek(audio, time);
    audio.playbackRate = rate;
    start(audio);
  } else if (!audio.seeking && Math.abs(audio.currentTime - time) > DRIFT) {
    seek(audio, time);
  }
}

/** Play: a sound the browser refuses waits for a click, a video falls back to muted, then to seeking. */
function start(element: HTMLMediaElement) {
  const turn = next(element);
  element.play()?.catch((error: unknown) => {
    const name = (error as Error)?.name;
    // Paused again before it started (a click finished the beat) is normal, and so is a refusal
    // that comes after the clip stopped.
    if (name === 'AbortError' || turns.get(element) !== turn) return;
    if (name === 'NotAllowedError' && !element.muted && sounding.has(element)) {
      refused.add(element);
      for (const listener of refusals) listener();
      if (!isVideo(element)) return;
      element.muted = true;
      start(element);
      return;
    }
    // Anything else, such as an autoplay policy for muted video too, means seeking frame by
    // frame instead; a sound that can't play (a format the browser lacks) stays silent.
    if (isVideo(element)) unplayable.add(element);
    else {
      refused.add(element);
      console.warn('[tobos] a sound would not play', error);
    }
  });
}

/**
 * Fade a sound out over `seconds`, then pause it; at once where it isn't playing, where `seconds`
 * is 0, or where the browser keeps the volume to itself (iPhone and iPad). Resolves once it is
 * silent.
 */
function silence(audio: HTMLMediaElement, seconds: number): Promise<void> {
  stopped(audio);
  const fading = fades.get(audio);
  if (fading && seconds > 0) return fading.silent;
  unfade(audio);
  if (audio.paused) return Promise.resolve();
  if (seconds === 0 || !volumeWorks()) {
    audio.pause();
    return Promise.resolve();
  }
  const volume = audio.volume;
  const level = { volume };
  let done = () => {};
  const silent = new Promise<void>((resolve) => (done = resolve));
  // A tween of its own, outside the scene's timeline: the position can't seek a fade.
  const tween = gsap.to(level, {
    volume: 0,
    duration: seconds,
    ease: 'none',
    onUpdate: () => void (audio.volume = level.volume),
    onComplete: () => {
      unfade(audio);
      audio.pause();
    },
  });
  fades.set(audio, { tween, volume, done, silent });
  return silent;
}

/** End a fade, if one runs: the sound gets its volume back, and its fade counts as done. */
function unfade(audio: HTMLMediaElement) {
  const fading = fades.get(audio);
  if (!fading) return;
  fades.delete(audio);
  fading.tween.kill();
  audio.volume = fading.volume;
  fading.done();
}

let volumeAvailable: boolean | undefined;

/** Whether this browser lets a page set a sound's volume: iPhone and iPad keep it at 1. */
function volumeWorks(): boolean {
  if (volumeAvailable === undefined) {
    const probe = document.createElement('audio');
    probe.volume = 0.5;
    volumeAvailable = probe.volume === 0.5;
  }
  return volumeAvailable;
}

/** Its clip has stopped: what the browser refused it is forgotten, and so is a refusal on its way. */
function stopped(element: HTMLMediaElement) {
  refused.delete(element);
  next(element);
}

function next(element: HTMLMediaElement): number {
  const turn = (turns.get(element) ?? 0) + 1;
  turns.set(element, turn);
  return turn;
}

let listening = false;

/** Unlock sounding elements on every click, tap or key press in this window. */
function listenForGestures() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  // Not pointerdown alone: a touch lets a page play sound only once the finger lifts.
  for (const type of ['pointerdown', 'pointerup', 'keydown'] as const)
    window.addEventListener(type, unlock, true);
}

/**
 * In a click or key press, which lets this window make sound: a sound the browser refused
 * starts now (the timeline puts it at its time), a video refused its sound gets it, and any
 * other element that makes sound is played and paused at once. Chrome and Firefox let a window
 * make sound once it has had a click or key press, Safari each element a gesture has played.
 */
function unlock() {
  for (const element of document.querySelectorAll<HTMLMediaElement>('audio, video')) {
    if (!sounding.has(element)) continue;
    if (refused.has(element)) {
      refused.delete(element);
      unlocked.add(element);
      element.muted = false;
      element.play()?.catch(() => undefined);
    } else if (!unlocked.has(element) && element.paused) {
      unlocked.add(element);
      element.play()?.catch(() => undefined);
      element.pause();
    }
  }
}

/** Seek a paused video to `time`, and see that the frame there reaches the screen. */
function land(video: HTMLVideoElement, time: number, tolerance?: number) {
  if (seek(video, time, tolerance)) repaint(video);
}

/** Seek, unless the element is within `tolerance` seconds of `time` already. */
function seek(element: HTMLMediaElement, time: number, tolerance = 0.0005): boolean {
  if (Math.abs(element.currentTime - time) <= tolerance) return false;
  element.currentTime = time;
  return true;
}

/**
 * Once a paused video's seek is done and two frames have gone by, have the browser hand the
 * frame it decoded to the screen once more.
 *
 * Chromium can leave the frame from before the seek on screen, for good: a paused video hands
 * each new frame to the compositor once, and drops it while the compositor hasn't acknowledged
 * the frame before (VideoFrameSubmitter::SubmitFrame). A video that has just loaded paints its
 * first frame, and the seek's frame follows 10–20 ms later. So a reload or a jump onto a beat
 * that lands mid-clip or on a clip's end could show the clip's first frame, with currentTime,
 * `seeked` and a canvas drawImage all right: 1 reload in 10 in headless Chromium on two cores,
 * nearly every one in Chromium's full build on one core.
 *
 * Asking for a video frame callback makes Chromium submit the current frame again, and once more
 * a second later. Two frames after the seek, the acknowledgement has come; asked at once, it
 * often hadn't. It costs no seek and leaves the time alone. The callback itself is cancelled: it
 * would only wait for the next new frame.
 */
function repaint(video: HTMLVideoElement) {
  if (repaints.has(video) || typeof video.requestVideoFrameCallback !== 'function') return;
  // Seeks begun while it waits, even one done again before its frames are: that seek's frame is
  // the one to show, two frames after it.
  let seeks = 0;
  const sought = () => seeks++;
  video.addEventListener('seeking', sought);
  const done = (async () => {
    let again: boolean;
    do {
      while (video.seeking) await anyOf(video, ['seeked', 'emptied', 'error']);
      const seen = seeks;
      await nextFrame();
      await nextFrame();
      again = video.seeking || seeks !== seen;
    } while (again);
    if (video.paused) video.cancelVideoFrameCallback(video.requestVideoFrameCallback(() => {}));
  })().finally(() => {
    video.removeEventListener('seeking', sought);
    repaints.delete(video);
  });
  repaints.set(video, done);
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const anyOf = (video: HTMLVideoElement, names: readonly string[]) =>
  new Promise<void>((resolve) => {
    const done = () => {
      for (const name of names) video.removeEventListener(name, done);
      resolve();
    };
    for (const name of names) video.addEventListener(name, done);
  });

/**
 * Wait until the videos and sounds inside `root` know their length, so `playVideo` and
 * `playAudio` can size their clips when the scene's timeline is built. Those that won't load (no
 * source, `preload="none"`, an error) don't hold it up, nor does anything past `timeout`.
 */
export function mediaKnowTheirLength(root: Element, timeout = 5000): Promise<void> {
  const waiting = [...root.querySelectorAll<HTMLMediaElement>('video, audio')].filter(
    (element) =>
      element.readyState < HTMLMediaElement.HAVE_METADATA &&
      !element.error &&
      element.preload !== 'none' &&
      hasSource(element),
  );
  if (waiting.length === 0) return Promise.resolve();
  let timer = 0;
  return Promise.race([
    Promise.all(
      waiting.map(
        (element) =>
          new Promise<void>((resolve) => {
            element.addEventListener('loadedmetadata', () => resolve(), { once: true });
            element.addEventListener('error', () => resolve(), { once: true });
          }),
      ),
    ),
    new Promise<void>((resolve) => (timer = window.setTimeout(resolve, timeout))),
  ]).then(() => window.clearTimeout(timer));
}

/**
 * Wait until every video inside `root` shows the frame it was last sought to: no seek pending,
 * a frame decoded, and that frame handed to the screen again (`repaint`). Videos that won't load
 * don't hold it up.
 */
export async function videoFramesReady(root: Element): Promise<void> {
  const pending = (video: HTMLVideoElement) =>
    (video.seeking || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) &&
    !video.error &&
    video.preload !== 'none' &&
    hasSource(video);
  const videos = [...root.querySelectorAll('video')].filter((video) => !video.closest('[inert]'));
  await Promise.all(
    videos.map(async (video) => {
      // An event says something changed; the short tick catches a state that changed without
      // one we listen for. The caller bounds the whole wait.
      while (pending(video))
        await new Promise<void>((resolve) => {
          const done = () => {
            for (const name of EVENTS) video.removeEventListener(name, done);
            window.clearTimeout(tick);
            resolve();
          };
          for (const name of EVENTS) video.addEventListener(name, done);
          const tick = window.setTimeout(done, 250);
        });
      await repaints.get(video);
    }),
  );
}

// Not networkState: it says "no source" until the browser has looked, a moment after mounting.
const hasSource = (element: HTMLMediaElement) =>
  Boolean(element.getAttribute('src') || element.querySelector('source[src]'));

const EVENTS = ['seeked', 'loadeddata', 'canplay', 'error', 'emptied'] as const;
