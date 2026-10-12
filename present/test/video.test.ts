// @vitest-environment jsdom
import type { gsap } from 'gsap';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { playVideo, type Beat } from '../src/index.ts';
import { SceneTimeline } from '../src/timeline.ts';
import { videoFramesReady, videosKnowTheirLength } from '../src/video.ts';

/**
 * jsdom can't decode video, so a <video> whose media state is ours: it records every seek,
 * play and pause, and moves only when told (`advance`).
 */
function fakeVideo(duration = 2) {
  const video = document.createElement('video');
  video.setAttribute('src', 'clip.webm');
  const state = { time: 0, paused: true, seeking: false, readyState: 4, refuse: false };
  const log: string[] = [];
  Object.defineProperties(video, {
    duration: { get: () => (state.readyState >= 1 ? duration : NaN) },
    readyState: { get: () => state.readyState },
    seeking: { get: () => state.seeking },
    ended: { get: () => false },
    paused: { get: () => state.paused },
    playbackRate: { value: 1, writable: true },
    currentTime: {
      get: () => state.time,
      set: (t: number) => {
        state.time = t;
        log.push(`seek ${+t.toFixed(3)}`);
      },
    },
    play: {
      value: () => {
        if (state.refuse) {
          log.push('play refused');
          return Promise.reject(new DOMException('no', 'NotAllowedError'));
        }
        state.paused = false;
        log.push(`play at ${+state.time.toFixed(3)} ×${video.playbackRate}`);
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        state.paused = true;
        log.push('pause');
      },
    },
  });
  return {
    video,
    state,
    log,
    /** What happened since last asked. */
    take: () => log.splice(0),
    /** Let the video play on by `seconds`, as a browser would. */
    advance: (seconds: number) => {
      if (!state.paused) state.time += seconds * video.playbackRate;
    },
  };
}

/**
 * The play() calls in a log. GSAP renders a step's start before its first frame, so a step may
 * start the video there, or seek to the first frame and start it there: both are right.
 */
const plays = (log: string[]) => log.filter((line) => line.startsWith('play'));

/** The forward step that's playing, put at `progress`: a stand-in for GSAP's ticker. */
function playTo(scene: SceneTimeline, progress: number) {
  (scene as unknown as { tween: gsap.core.Tween }).tween.progress(progress);
}

let root: HTMLElement;
let fake: ReturnType<typeof fakeVideo>;

beforeEach(() => {
  root = document.createElement('div');
  fake = fakeVideo(2);
  root.append(fake.video);
  document.body.append(root);
});
afterEach(() => root.remove());

// A two-second video in two halves, after a beat that only shows it.
const beats: Beat[] = [
  { id: 'start' },
  { id: 'half', enter: (tl, q) => playVideo(tl, q('video'), { to: 1 }) },
  { id: 'rest', enter: (tl, q) => playVideo(tl, q('video'), { from: 1 }) },
];

describe('playVideo', () => {
  it('makes the video muted, inline, preloading and paused', () => {
    fake.video.autoplay = true;
    fake.video.loop = true;
    fake.state.paused = false;
    new SceneTimeline(root, beats);
    expect(fake.video.muted).toBe(true);
    expect(fake.video.hasAttribute('playsinline')).toBe(true);
    expect(fake.video.preload).toBe('auto');
    expect(fake.video.autoplay).toBe(false);
    expect(fake.video.loop).toBe(false);
    expect(fake.state.paused).toBe(true);
  });

  it('adds a clip as long as its part of the video, at its rate', () => {
    const scene = new SceneTimeline(root, beats);
    expect(scene.duration(1)).toBe(1);
    expect(scene.duration(2)).toBe(1);
    const slow = new SceneTimeline(root, [
      { id: 'slow', enter: (tl, q) => playVideo(tl, q('video'), { from: 0.5, rate: 0.5 }) },
    ]);
    expect(slow.duration(0)).toBe(3);
  });

  it('lands on the frame for any position at once, paused, and never plays', () => {
    const scene = new SceneTimeline(root, beats);
    for (const [beat, time] of [
      [2, 2],
      [0, 0],
      [1, 1],
      [2, 2],
      [1, 1],
    ] as const) {
      scene.show(beat, false);
      expect(fake.state.time, `beat ${beat}`).toBe(time);
      expect(fake.state.paused).toBe(true);
    }
    expect(fake.log.filter((l) => l.startsWith('play'))).toEqual([]);
  });

  it('holds the first frame before its beat, mounted ahead, and does not play', () => {
    const scene = new SceneTimeline(root, beats);
    scene.show(2, false);
    scene.hold();
    expect(fake.state.time).toBe(0);
    expect(fake.state.paused).toBe(true);
    const late = fakeVideo(2);
    root.replaceChildren(late.video);
    new SceneTimeline(root, [
      { id: 'later', enter: (tl, q) => playVideo(tl, q('video'), { from: 1.5 }) },
    ]).hold();
    expect(late.state.time).toBe(1.5);
    expect(late.log.filter((l) => l.startsWith('play'))).toEqual([]);
  });

  it('plays a step forward with the video playing itself, from the right frame', () => {
    const scene = new SceneTimeline(root, beats);
    scene.show(0, false);
    fake.take();
    scene.show(1, true);
    playTo(scene, 0.1);
    expect(plays(fake.take())).toEqual(['play at 0 ×1']);
    // While it keeps up, nothing more happens: no seeking every frame.
    for (const progress of [0.2, 0.3, 0.4, 0.5]) {
      fake.advance(0.1);
      playTo(scene, progress);
    }
    expect(fake.take()).toEqual([]);
    // Fallen behind (a stall): put back where the timeline is.
    playTo(scene, 0.9);
    expect(fake.take()).toEqual(['seek 0.9']);
    // The end of the beat: paused on the clip's last frame.
    playTo(scene, 1);
    expect(fake.take()).toEqual(['pause', 'seek 1']);
    expect(scene.playing).toBe(false);
  });

  it('plays at its rate', () => {
    const scene = new SceneTimeline(root, [
      { id: 'slow', enter: (tl, q) => playVideo(tl, q('video'), { to: 1, rate: 0.5 }) },
    ]);
    scene.hold();
    scene.show(0, true);
    playTo(scene, 0.1);
    expect(plays(fake.take())).toEqual(['play at 0 ×0.5']);
    expect(scene.duration(0)).toBe(2);
  });

  it('lands on the last frame when a click finishes the beat', () => {
    const scene = new SceneTimeline(root, beats);
    scene.show(0, false);
    scene.show(1, true);
    playTo(scene, 0.3);
    fake.take();
    scene.finish();
    expect(fake.take()).toEqual(['pause', 'seek 1']);
    // The next click plays the next clip from there.
    scene.show(2, true);
    playTo(scene, 0.2);
    expect(plays(fake.take())).toEqual([expect.stringMatching(/^play at 1(\.2)? ×1$/)]);
    expect(fake.state.paused).toBe(false);
    // Going back while it plays lands on the previous beat's end frame.
    scene.show(1, false);
    expect(fake.state).toMatchObject({ time: 1, paused: true });
  });

  it('follows the timeline even when GSAP seeks with events suppressed', () => {
    const scene = new SceneTimeline(root, beats);
    scene.timeline.seek(1.5, true);
    expect(fake.state.time).toBe(1.5);
    scene.sample(2, 0.25);
    expect(fake.state.time).toBe(1.25);
  });

  it('seeks frame by frame where the browser refuses to play', async () => {
    fake.state.refuse = true;
    const scene = new SceneTimeline(root, beats);
    scene.show(0, false);
    scene.show(1, true);
    playTo(scene, 0.05);
    expect(plays(fake.take()).length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r));
    playTo(scene, 0.1);
    playTo(scene, 0.2);
    playTo(scene, 0.3);
    // (GSAP's own ticker may have moved it on meanwhile, by seeking too.)
    const log = fake.take();
    expect(log.filter((line) => !line.startsWith('seek'))).toEqual([]);
    expect(log.slice(-3)).toEqual(['seek 0.1', 'seek 0.2', 'seek 0.3']);
  });

  it('drives several videos side by side', () => {
    const other = fakeVideo(1);
    root.append(other.video);
    const scene = new SceneTimeline(root, [
      { id: 'both', enter: (tl, q) => playVideo(tl, q('video')) },
    ]);
    expect(scene.duration(0)).toBe(2);
    scene.show(0, false);
    expect([fake.state.time, other.state.time]).toEqual([2, 1]);
  });
});

describe('waiting for video', () => {
  it("waits until a scene's videos know their length", async () => {
    fake.state.readyState = 0;
    let done = false;
    const waiting = videosKnowTheirLength(root).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    fake.state.readyState = 1;
    fake.video.dispatchEvent(new Event('loadedmetadata'));
    await waiting;
    expect(done).toBe(true);
  });

  it("doesn't wait for a video that won't load, nor past the timeout", async () => {
    fake.state.readyState = 0;
    const none = document.createElement('video');
    root.append(none);
    const started = Date.now();
    await videosKnowTheirLength(root, 50);
    expect(Date.now() - started).toBeLessThan(500);
    fake.video.removeAttribute('src');
    await videosKnowTheirLength(root);
  });

  it('waits for a pending seek before a frame counts as drawn', async () => {
    fake.state.seeking = true;
    let done = false;
    const waiting = videoFramesReady(root).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    fake.state.seeking = false;
    fake.video.dispatchEvent(new Event('seeked'));
    await waiting;
    expect(done).toBe(true);
  });

  it('waits again after a seek, where "loadeddata" never comes twice', async () => {
    // Seeking drops a video to HAVE_METADATA; the old wait listened for loadeddata and hung.
    fake.state.readyState = 1;
    let done = false;
    const waiting = videoFramesReady(root).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toBe(false);
    fake.state.readyState = 4;
    fake.video.dispatchEvent(new Event('canplay'));
    await waiting;
    expect(done).toBe(true);
  });

  it('ignores videos in scenes out of sight', async () => {
    fake.state.seeking = true;
    root.setAttribute('inert', '');
    await videoFramesReady(root);
  });
});
