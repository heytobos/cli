// @vitest-environment jsdom
import type { gsap } from 'gsap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Beat } from '../src/index.ts';
import { SceneTimeline } from '../src/timeline.ts';
import {
  mediaKnowTheirLength,
  onSoundRefused,
  playAudio,
  playVideo,
  videoFramesReady,
} from '../src/playback.ts';

/**
 * jsdom can't decode video or sound, so a <video> (or an <audio>) whose media state is ours: it
 * records every seek, play and pause, and moves only when told (`advance`).
 */
function fakeVideo(duration = 2, tag: 'video' | 'audio' = 'video') {
  const video = document.createElement(tag) as HTMLVideoElement;
  video.setAttribute('src', tag === 'video' ? 'clip.webm' : 'sound.m4a');
  const state = {
    time: 0,
    paused: true,
    seeking: false,
    readyState: 4,
    refuse: false,
    /** Refuse to play with sound, as a browser does before a click or key press in the window. */
    refuseSound: false,
    /** Video frame callbacks asked for, which is how the viewer has a frame drawn again. */
    repaints: 0,
  };
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
        if (state.refuse || (state.refuseSound && !video.muted)) {
          log.push('play refused');
          return Promise.reject(new DOMException('no', 'NotAllowedError'));
        }
        state.paused = false;
        log.push(
          `play at ${+state.time.toFixed(3)} ×${video.playbackRate}${video.muted ? '' : ' aloud'}`,
        );
        return Promise.resolve();
      },
    },
    pause: {
      value: () => {
        state.paused = true;
        log.push('pause');
      },
    },
    requestVideoFrameCallback: { value: () => ++state.repaints },
    cancelVideoFrameCallback: { value: () => {} },
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

  it('lands exactly on the end of a step that stopped playing a hair short of it', () => {
    // At 0.9998 s the screen shows the frame before the one at 1 s.
    const scene = new SceneTimeline(root, beats);
    scene.show(0, false);
    scene.show(1, true);
    playTo(scene, 0.1);
    fake.advance(0.9998);
    fake.take();
    playTo(scene, 1);
    expect(fake.take()).toEqual(['pause', 'seek 1']);
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

describe('playAudio', () => {
  let sound: ReturnType<typeof fakeVideo>;
  beforeEach(() => {
    sound = fakeVideo(2, 'audio');
    root.replaceChildren(sound.video);
  });

  // A two-second sound in two halves, after a beat that is quiet.
  const sounds: Beat[] = [
    { id: 'quiet' },
    { id: 'listen', enter: (tl, q) => playAudio(tl, q('audio'), { to: 1 }) },
    { id: 'more', enter: (tl, q) => playAudio(tl, q('audio'), { from: 1 }) },
  ];
  const tick = () => new Promise((r) => setTimeout(r));

  it('makes the sound heard, preloading and paused', () => {
    sound.video.muted = true;
    sound.video.autoplay = true;
    sound.video.loop = true;
    sound.state.paused = false;
    new SceneTimeline(root, sounds);
    expect(sound.video.muted).toBe(false);
    expect(sound.video.preload).toBe('auto');
    expect(sound.video.autoplay).toBe(false);
    expect(sound.video.loop).toBe(false);
    expect(sound.state.paused).toBe(true);
  });

  it('adds a clip as long as its part of the sound, at its rate', () => {
    const scene = new SceneTimeline(root, sounds);
    expect(scene.duration(1)).toBe(1);
    expect(scene.duration(2)).toBe(1);
    const slow = new SceneTimeline(root, [
      { id: 'slow', enter: (tl, q) => playAudio(tl, q('audio'), { rate: 0.5 }) },
    ]);
    expect(slow.duration(0)).toBe(4);
  });

  it('plays a step forward aloud, by itself, and a click stops it', () => {
    const scene = new SceneTimeline(root, sounds);
    scene.show(0, false);
    sound.take();
    scene.show(1, true);
    playTo(scene, 0.1);
    expect(plays(sound.take())).toEqual(['play at 0 ×1 aloud']);
    for (const progress of [0.2, 0.3, 0.4]) {
      sound.advance(0.1);
      playTo(scene, progress);
    }
    expect(sound.take()).toEqual([]);
    // Nothing shows where a sound is: it stops where it is, and the next clip seeks.
    scene.finish();
    expect(sound.take()).toEqual(['pause']);
    scene.show(2, true);
    playTo(scene, 0.2);
    expect(plays(sound.take())).toEqual([expect.stringMatching(/^play at 1(\.2)? ×1 aloud$/)]);
  });

  it('is silent wherever the position is landed on, and before its beat', () => {
    const scene = new SceneTimeline(root, sounds);
    for (const beat of [2, 0, 1, 2, 1]) scene.show(beat, false);
    scene.hold();
    expect(plays(sound.log)).toEqual([]);
    expect(sound.state.paused).toBe(true);
  });

  it('plays the step silent in a window that follows another', () => {
    const scene = new SceneTimeline(root, sounds);
    scene.show(0, false);
    scene.show(1, true, false);
    for (const progress of [0.1, 0.5, 1]) playTo(scene, progress);
    expect(plays(sound.log)).toEqual([]);
  });

  it('waits for a click where the browser refuses it sound, and says so', async () => {
    sound.state.refuseSound = true;
    let refusals = 0;
    const stop = onSoundRefused(() => refusals++);
    const scene = new SceneTimeline(root, sounds);
    scene.show(0, false);
    scene.show(1, true);
    playTo(scene, 0.1);
    await tick();
    expect(refusals).toBe(1);
    sound.take();
    // Not asked again every frame.
    playTo(scene, 0.2);
    playTo(scene, 0.3);
    expect(sound.take()).toEqual([]);
    // A click lets it: it starts at once, and the timeline puts it where it should be.
    sound.state.refuseSound = false;
    window.dispatchEvent(new Event('pointerdown'));
    expect(plays(sound.take())).toEqual([expect.stringMatching(/aloud$/)]);
    playTo(scene, 0.8);
    expect(sound.take()).toEqual(['seek 0.8']);
    stop();
  });

  it('forgets a refusal that comes after its clip stopped', async () => {
    sound.state.refuseSound = true;
    const scene = new SceneTimeline(root, sounds);
    scene.show(0, false);
    scene.show(1, true);
    playTo(scene, 0.1);
    scene.finish();
    await tick();
    sound.state.refuseSound = false;
    sound.take();
    scene.show(2, true);
    playTo(scene, 0.2);
    expect(plays(sound.take())).toEqual([expect.stringMatching(/aloud$/)]);
  });

  it('is played and paused at once by a click, so that a browser lets it be heard later', () => {
    new SceneTimeline(root, sounds);
    sound.take();
    window.dispatchEvent(new Event('pointerdown'));
    expect(sound.take()).toEqual(['play at 0 ×1 aloud', 'pause']);
    window.dispatchEvent(new Event('keydown'));
    expect(sound.take()).toEqual([]);
  });

  it("waits until a scene's sounds know their length", async () => {
    sound.state.readyState = 0;
    let done = false;
    const waiting = mediaKnowTheirLength(root).then(() => (done = true));
    await tick();
    expect(done).toBe(false);
    sound.state.readyState = 1;
    sound.video.dispatchEvent(new Event('loadedmetadata'));
    await waiting;
    expect(done).toBe(true);
  });
});

describe('playAudio until a later beat', () => {
  let sound: ReturnType<typeof fakeVideo>;
  beforeEach(() => {
    sound = fakeVideo(10, 'audio');
    root.replaceChildren(sound.video);
  });

  // Music from `music` up to `outro`, over two beats of their own.
  const ranged = (fade = 0): Beat[] => [
    { id: 'quiet' },
    { id: 'music', enter: (tl, q) => playAudio(tl, q('audio'), { until: 'outro', fade }) },
    { id: 'first' },
    { id: 'second' },
    { id: 'outro' },
  ];

  it("doesn't make its beat wait for it", () => {
    expect(new SceneTimeline(root, ranged()).duration(1)).toBe(0);
  });

  it('plays on through the beats of its range, whichever way they are moved through', () => {
    const scene = new SceneTimeline(root, ranged());
    scene.show(0, false);
    sound.take();
    scene.show(1, true);
    expect(plays(sound.take())).toEqual(['play at 0 ×1 aloud']);
    sound.advance(1);
    scene.show(2, true);
    scene.finish();
    scene.show(3, true);
    scene.show(2, false);
    scene.show(1, false);
    scene.show(2, true);
    expect(sound.take()).toEqual([]);
    expect(sound.state.paused).toBe(false);
    // The beat it plays until stops it.
    scene.show(3, true);
    scene.show(4, true);
    expect(sound.take()).toEqual(['pause']);
  });

  it('stops leaving its range backwards, and starts from its start stepping onto it again', () => {
    const scene = new SceneTimeline(root, ranged());
    scene.show(0, false);
    scene.show(1, true);
    sound.advance(2);
    sound.take();
    scene.show(0, false);
    expect(sound.take()).toEqual(['pause']);
    scene.show(1, true);
    expect(sound.take()).toEqual(['seek 0', 'play at 0 ×1 aloud']);
  });

  it('is silent landing in its range, and in a window that follows another', () => {
    const scene = new SceneTimeline(root, ranged());
    scene.show(2, false);
    scene.show(1, false);
    scene.show(0, false);
    scene.show(1, true, false);
    scene.show(2, true, false);
    expect(plays(sound.log)).toEqual([]);
  });

  it('fades out, then pauses with its volume back', async () => {
    const scene = new SceneTimeline(root, ranged(0.1));
    scene.show(0, false);
    scene.show(1, true);
    scene.show(4, false);
    expect(sound.state.paused).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(sound.video.volume).toBeLessThan(1);
    expect(sound.video.volume).toBeGreaterThan(0);
    await scene.fading;
    expect(sound.state.paused).toBe(true);
    expect(sound.video.volume).toBe(1);
  });

  it('starts again at full volume, stepped onto while it fades', async () => {
    const scene = new SceneTimeline(root, ranged(0.2));
    scene.show(0, false);
    scene.show(1, true);
    scene.show(0, false);
    await new Promise((r) => setTimeout(r, 60));
    scene.show(1, true);
    expect(sound.video.volume).toBe(1);
    await new Promise((r) => setTimeout(r, 250));
    expect(sound.state.paused).toBe(false);
    expect(scene.fading).toBe(null);
  });

  it('fades out when its scene leaves the stage, and stops at once when it is unmounted', () => {
    const scene = new SceneTimeline(root, ranged(1));
    scene.show(0, false);
    scene.show(1, true);
    scene.leave();
    expect(scene.fading).not.toBe(null);
    expect(sound.state.paused).toBe(false);
    scene.kill();
    expect(sound.state.paused).toBe(true);
    expect(sound.video.volume).toBe(1);
  });

  it('warns of an until that names no later beat, and plays nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = new SceneTimeline(root, [
      { id: 'a' },
      { id: 'b', enter: (tl, q) => playAudio(tl, q('audio'), { until: 'a' }) },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('until names "a"'));
    warn.mockRestore();
    scene.show(0, false);
    scene.show(1, true);
    expect(plays(sound.log)).toEqual([]);
  });
});

describe('playVideo with sound', () => {
  const talking: Beat[] = [
    { id: 'start' },
    { id: 'talk', enter: (tl, q) => playVideo(tl, q('video'), { sound: true }) },
  ];

  it('is heard on a step forward, and muted in a window that follows another', () => {
    const scene = new SceneTimeline(root, talking);
    expect(fake.video.muted).toBe(false);
    scene.show(0, false);
    fake.take();
    scene.show(1, true);
    playTo(scene, 0.1);
    expect(plays(fake.take())).toEqual(['play at 0 ×1 aloud']);
    scene.show(0, false);
    fake.take();
    scene.show(1, true, false);
    playTo(scene, 0.1);
    expect(plays(fake.take())).toEqual([expect.stringMatching(/^play at 0(\.2)? ×1$/)]);
  });

  it('plays on muted where the browser refuses it sound, until a click', async () => {
    fake.state.refuseSound = true;
    let refusals = 0;
    const stop = onSoundRefused(() => refusals++);
    const scene = new SceneTimeline(root, talking);
    scene.show(0, false);
    fake.take();
    scene.show(1, true);
    playTo(scene, 0.1);
    await new Promise((r) => setTimeout(r));
    // Refused aloud, then playing muted.
    const log = plays(fake.take());
    expect(log[0]).toBe('play refused');
    expect(log.at(-1)).toMatch(/^play at 0(\.2)? ×1$/);
    expect(refusals).toBe(1);
    expect(fake.state.paused).toBe(false);
    window.dispatchEvent(new Event('pointerdown'));
    expect(fake.video.muted).toBe(false);
    stop();
  });
});

describe('the frame a paused video lands on', () => {
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
  };

  it('is handed to the screen again once its seek is done, and the time stays', async () => {
    // Chromium drops a paused video's new frame while the one before is still unacknowledged:
    // the first frame after loading, then a seek's 10–20 ms later, left the first on screen.
    const scene = new SceneTimeline(root, beats);
    fake.state.seeking = true;
    scene.show(2, false);
    let drawn = false;
    const waiting = videoFramesReady(root).then(() => (drawn = true));
    await frames(3);
    expect(fake.state.repaints, 'not while it seeks').toBe(0);
    fake.state.seeking = false;
    fake.video.dispatchEvent(new Event('seeked'));
    await waiting;
    expect(fake.state.repaints).toBe(1);
    expect(drawn).toBe(true);
    expect(fake.state).toMatchObject({ time: 2, paused: true });
  });

  it('waits for the last of several seeks', async () => {
    const scene = new SceneTimeline(root, beats);
    fake.state.seeking = true;
    scene.show(2, false);
    fake.state.seeking = false;
    fake.video.dispatchEvent(new Event('seeked'));
    fake.state.seeking = true;
    scene.show(1, false);
    await frames(3);
    expect(fake.state.repaints).toBe(0);
    fake.state.seeking = false;
    fake.video.dispatchEvent(new Event('seeked'));
    await videoFramesReady(root);
    expect(fake.state.repaints).toBe(1);
  });

  it('waits two frames again after a seek that begins and ends within them', async () => {
    const scene = new SceneTimeline(root, beats);
    scene.show(2, false);
    const ready = videoFramesReady(root);
    await frames(1);
    // Another seek, begun and done before the wait's second frame.
    fake.video.dispatchEvent(new Event('seeking'));
    fake.video.dispatchEvent(new Event('seeked'));
    await frames(2);
    expect(fake.state.repaints, 'not two frames after the first seek').toBe(0);
    await ready;
    expect(fake.state.repaints).toBe(1);
  });

  it('needs nothing more while a step plays', async () => {
    const scene = new SceneTimeline(root, beats);
    scene.show(0, false);
    scene.show(1, true);
    for (const progress of [0.1, 0.2, 0.3]) {
      fake.advance(0.1);
      playTo(scene, progress);
    }
    await frames(3);
    expect(fake.state.repaints).toBe(0);
  });
});

describe('waiting for video', () => {
  it("waits until a scene's videos know their length", async () => {
    fake.state.readyState = 0;
    let done = false;
    const waiting = mediaKnowTheirLength(root).then(() => (done = true));
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
    await mediaKnowTheirLength(root, 50);
    expect(Date.now() - started).toBeLessThan(500);
    fake.video.removeAttribute('src');
    await mediaKnowTheirLength(root);
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
