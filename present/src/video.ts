/**
 * Video in beats. The scene's timeline is the clock and a video follows it, so what a video
 * shows depends only on the position, like everything else on the stage.
 */
import { gsap } from 'gsap';
import { playingForward } from './timeline.ts';

export interface PlayVideoOptions {
  /** Where the clip starts in the video, in seconds. Default 0. */
  from?: number;
  /** Where the clip ends in the video, in seconds. Default: the end of the video. */
  to?: number;
  /** Speed: 1 is real time, 0.5 half speed. Default 1. */
  rate?: number;
  /**
   * When the clip starts within the beat: GSAP's position parameter (`'<'`, `'+=0.5'`, a
   * number). Default: after what the beat has animated so far, like any `tl.to`.
   */
  position?: gsap.Position;
}

/** How far a playing video may drift from the timeline before it is put back, in seconds. */
const DRIFT = 0.25;

/** Videos whose first clip has set their opening frame. */
const opened = new WeakSet<HTMLVideoElement>();
/** Videos whose play() the browser refused: they follow the timeline by seeking. */
const unplayable = new WeakSet<HTMLVideoElement>();
/** Paused videos whose landing frame is still to be put on screen again (`repaint`). */
const repaints = new WeakMap<HTMLVideoElement, Promise<void>>();

/**
 * Play a video (or the clip `from`–`to` of it) as part of a beat. Stepping forward plays it in
 * real time; going back, jumping or reloading shows the frame for that position at once; a
 * click while it plays lands on its last frame. Before its beat it shows the clip's first frame.
 *
 * ```ts
 * { id: 'turn', enter: (tl, q) => playVideo(tl, q('video')) }
 * ```
 *
 * The video is muted, plays inline and preloads. Several videos (`q('video')` finding more
 * than one) play side by side, each its own length.
 */
export function playVideo(
  tl: gsap.core.Timeline,
  target: Element | ArrayLike<Element> | null | undefined,
  options: PlayVideoOptions = {},
): gsap.core.Timeline {
  const videos = videosIn(target);
  if (videos.length === 0) console.warn('[tobos] playVideo found no <video> element');
  videos.forEach((video, i) => {
    prepare(video);
    const from = Math.max(0, options.from ?? 0);
    const to = options.to ?? video.duration;
    const rate = options.rate !== undefined && options.rate > 0 ? options.rate : 1;
    if (!Number.isFinite(to))
      console.warn(
        "[tobos] playVideo: the video's length isn't known (has it loaded?); pass { to } in seconds",
      );
    const duration = Number.isFinite(to) ? Math.abs(to - from) / rate : 0;
    if (!opened.has(video)) {
      opened.add(video);
      land(video, from);
    }

    // GSAP calls a function-valued property as a setter on every render, seek or play, with
    // events suppressed or not. Its value is the clip's progress, 0..1.
    let progress = 0;
    const clip = {
      progress(value?: number): number {
        if (value === undefined) return progress;
        progress = value;
        const end = Number.isFinite(to) ? to : video.duration;
        if (!Number.isFinite(end)) return progress;
        const time = from + (end - from) * value;
        follow(video, time, value < 1 && end > from && playingForward(tween), rate);
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

function videosIn(target: Element | ArrayLike<Element> | null | undefined): HTMLVideoElement[] {
  if (!target) return [];
  const list = 'length' in target ? Array.from(target) : [target as Element];
  return list.filter((el): el is HTMLVideoElement => el?.tagName === 'VIDEO');
}

/** Muted, inline, preloading and paused: the timeline starts and stops it. */
function prepare(video: HTMLVideoElement) {
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('playsinline', '');
  video.autoplay = false;
  video.loop = false;
  if (video.preload !== 'auto') video.preload = 'auto';
  if (!video.paused) video.pause();
}

/**
 * Bring the video to `time`. While the timeline plays forward, the video plays itself and is
 * only put back if it drifts; otherwise it is paused on the frame for `time`.
 *
 * Why not seek on every frame: a seek decodes from the keyframe before it, and a new seek
 * abandons the one in flight. Measured in headless Chromium, 3 s of a 1080p clip with a
 * keyframe every 4 s: seeking every animation frame drew no frame at all, play() drew all 90.
 * A light 720p clip still showed gaps of 100–130 ms when seeking, 34 ms when playing.
 */
function follow(video: HTMLVideoElement, time: number, playing: boolean, rate: number) {
  if (playing && !unplayable.has(video) && !video.ended) {
    if (video.paused) {
      seek(video, time);
      video.playbackRate = rate;
      const started = video.play();
      started?.catch((error: unknown) => {
        // Paused again before it started (a click finished the beat) is normal. Anything
        // else, such as an autoplay policy, means seeking frame by frame instead.
        if ((error as Error)?.name !== 'AbortError') unplayable.add(video);
      });
    } else if (!video.seeking && Math.abs(video.currentTime - time) > DRIFT) {
      seek(video, time);
    }
    return;
  }
  // A video stopped a hair before `time` shows the frame before it where `time` is a frame's
  // first instant (a clip ending at a whole second), so a stop from playing lands exactly.
  const stopping = !video.paused;
  if (stopping) video.pause();
  land(video, time, stopping ? 0 : undefined);
}

/** Seek a paused video to `time`, and see that the frame there reaches the screen. */
function land(video: HTMLVideoElement, time: number, tolerance?: number) {
  if (seek(video, time, tolerance)) repaint(video);
}

/** Seek, unless the video is within `tolerance` seconds of `time` already. */
function seek(video: HTMLVideoElement, time: number, tolerance = 0.0005): boolean {
  if (Math.abs(video.currentTime - time) <= tolerance) return false;
  video.currentTime = time;
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
 * Wait until the videos inside `root` know their length, so `playVideo` can size their clips
 * when the scene's timeline is built. Videos that won't load (no source, `preload="none"`, an
 * error) don't hold it up, nor does anything past `timeout`.
 */
export function videosKnowTheirLength(root: Element, timeout = 5000): Promise<void> {
  const waiting = [...root.querySelectorAll('video')].filter(
    (video) =>
      video.readyState < HTMLMediaElement.HAVE_METADATA &&
      !video.error &&
      video.preload !== 'none' &&
      hasSource(video),
  );
  if (waiting.length === 0) return Promise.resolve();
  let timer = 0;
  return Promise.race([
    Promise.all(
      waiting.map(
        (video) =>
          new Promise<void>((resolve) => {
            video.addEventListener('loadedmetadata', () => resolve(), { once: true });
            video.addEventListener('error', () => resolve(), { once: true });
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
const hasSource = (video: HTMLVideoElement) =>
  Boolean(video.getAttribute('src') || video.querySelector('source[src]'));

const EVENTS = ['seeked', 'loadeddata', 'canplay', 'error', 'emptied'] as const;
