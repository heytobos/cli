import { gsap } from 'gsap';
import type { Beat, Query } from './index.ts';

/** Every scene timeline, by its GSAP timeline, so an animation inside one can ask about it. */
const scenes = new WeakMap<gsap.core.Timeline, SceneTimeline>();

/**
 * Whether the scene timeline that holds this animation is playing a step forward, in real
 * time, as opposed to being sought (a jump, a step back, a finish, a still view or a render).
 */
export function playingForward(animation: gsap.core.Animation): boolean {
  for (let parent = animation.parent; parent; parent = parent.parent) {
    const scene = scenes.get(parent);
    if (scene) return scene.playing;
  }
  return false;
}

/**
 * Whether the scene timeline that holds this animation is playing a step forward that may be
 * heard: one this window was moved to itself, not one it follows from another window.
 */
export function playingAloud(animation: gsap.core.Animation): boolean {
  for (let parent = animation.parent; parent; parent = parent.parent) {
    const scene = scenes.get(parent);
    if (scene) return scene.playing && scene.aloud;
  }
  return false;
}

/**
 * A sound that plays on through a range of a scene's beats, from the one that starts it up to,
 * not including, the one it stops at (playAudio's `until`).
 */
export interface Span {
  /** Play it from its start, heard. */
  start(): void;
  /** Stop it, fading it out or at once; resolves once it is silent. */
  stop(fade: boolean): Promise<void>;
}

/**
 * Add a span to the scene `tl` is the timeline of, while one of its beats' `enter` runs: from
 * that beat up to the one `until` names. False where `until` names no later beat of the scene.
 */
export function addSpan(tl: gsap.core.Timeline, until: string, span: Span): boolean {
  const scene = scenes.get(tl);
  return scene ? scene.addSpan(until, span) : false;
}

/**
 * What runs while the scene is at a range of its beats, from `first` up to, not including,
 * `until`, whichever way it moved there: a sound playing on (playAudio's `until`), or a loop.
 */
interface Range {
  first: number;
  until: number;
  /** The scene is at `beat`, in the range: `stepped` when a step forward, heard, played into it. */
  inside(beat: number, stepped: boolean): void;
  /** The scene is outside the range, or has left the stage. */
  outside(): void;
  /** The scene is gone: stop at once. */
  kill(): void;
}

/**
 * One scene's beats as one paused GSAP timeline, with a label after each beat's animation.
 * Stepping forward tweens the playhead to the next label; everything else seeks. A beat's loop
 * repeats on a timeline of its own, beside it, which this one never holds: seeking its labels
 * would reach none past a loop that runs for ever.
 */
export class SceneTimeline {
  readonly timeline: gsap.core.Timeline;
  private labels: string[] = [];
  private tween: gsap.core.Tween | null = null;
  /** Whether the step playing may be heard. */
  aloud = true;
  private ids: string[];
  /** The beat whose `enter` is running, while the timeline is built. */
  private building = -1;
  private ranges: Range[] = [];
  /** The ranges that are loops, which `loops` starts or stops. */
  private loopRanges: Range[] = [];
  /** The beat shown, -1 before the first or off the stage. */
  private at = -1;
  /**
   * Whether loops play, or each stays at its start. Off until a stage that plays them says so:
   * a page of the PDF never does.
   */
  private looping = false;
  /** The spans' stops still fading out. */
  private fades = new Set<Promise<void>>();

  constructor(root: Element, beats: readonly Beat[]) {
    const q: Query = (selector) => Array.from(root.querySelectorAll(selector));
    this.timeline = gsap.timeline({ paused: true });
    this.ids = beats.map((beat) => beat.id);
    scenes.set(this.timeline, this);
    beats.forEach((beat, index) => {
      this.building = index;
      beat.enter?.(this.timeline, q);
      // Labels are namespaced so a beat called "start" can't collide with GSAP's own words.
      const label = `beat:${index}`;
      this.timeline.addLabel(label);
      this.labels.push(label);
    });
    this.building = -1;
    this.timeline.seek(0, false);
    beats.forEach((beat, index) => this.addLoop(beat, index, q));
  }

  addSpan(until: string, span: Span): boolean {
    const last = this.ids.indexOf(until);
    if (this.building < 0 || last <= this.building) return false;
    const first = this.building;
    this.ranges.push({
      first,
      until: last,
      // Only a step forward onto its first beat, heard, starts it.
      inside: (beat, stepped) => {
        if (stepped && beat === first) span.start();
      },
      outside: () => {
        const stop = span.stop(true);
        this.fades.add(stop);
        void stop.finally(() => this.fades.delete(stop));
      },
      kill: () => void span.stop(false),
    });
    return true;
  }

  /** A beat's loop, repeating from its start each time the scene arrives in its range. */
  private addLoop(beat: Beat, index: number, q: Query) {
    if (!beat.loop) return;
    const until = beat.until === undefined ? this.ids.length : this.ids.indexOf(beat.until);
    if (until <= index) {
      console.warn(
        `[tobos] beat "${beat.id}": until names "${beat.until}", which is not a later beat of this scene`,
      );
      return;
    }
    const loop = gsap.timeline({ paused: true, repeat: -1 });
    beat.loop(loop, q);
    // A round that takes no time would repeat for ever within one frame.
    if (loop.duration() === 0) {
      console.warn(`[tobos] beat "${beat.id}": its loop animates nothing, so nothing repeats`);
      loop.kill();
      return;
    }
    const range: Range = {
      first: index,
      until,
      inside: () => {
        if (!this.looping) loop.pause(0);
        else if (loop.paused()) loop.restart();
      },
      outside: () => void loop.pause(0),
      kill: () => void loop.kill(),
    };
    this.ranges.push(range);
    this.loopRanges.push(range);
  }

  /** Play the loops, or keep each at its start: a still view, a render. Sound plays on as it was. */
  loops(on: boolean) {
    if (on === this.looping) return;
    this.looping = on;
    this.move(this.at, false, this.loopRanges);
  }

  /**
   * Whether a span is still fading out: a scene leaving the stage is unmounted once it is
   * silent, since its sound goes with its elements.
   */
  get fading(): Promise<void> | null {
    return this.fades.size ? Promise.all(this.fades).then(() => undefined) : null;
  }

  get playing(): boolean {
    return this.tween !== null && this.tween.progress() < 1;
  }

  /** Finish the beat that is playing, at once. */
  finish() {
    const tween = this.tween;
    this.tween = null;
    if (tween) {
      tween.progress(1);
      tween.kill();
    }
  }

  /** Before the first beat: the scene waiting for its entrance. */
  hold() {
    this.finish();
    this.timeline.seek(0, false);
    this.move(-1, false);
  }

  /** The scene has left the stage: its spans fade out, its loops stop. */
  leave() {
    this.move(-1, false);
  }

  /**
   * After a move to `beat` (-1: none), each range runs while the beat is in it, whichever way it
   * moved there, and stops outside it. `stepped`: a step forward, heard, played into the beat.
   */
  private move(beat: number, stepped: boolean, ranges = this.ranges) {
    this.at = beat;
    for (const range of ranges)
      if (beat < range.first || beat >= range.until) range.outside();
      else range.inside(beat, stepped);
  }

  /**
   * Show a beat: play the animation into it, or land on its end state. `aloud`: whether its
   * sound plays, or the step plays silent.
   */
  show(beat: number, animate: boolean, aloud = true) {
    const label = this.labels[Math.max(0, Math.min(beat, this.labels.length - 1))]!;
    this.finish();
    this.aloud = aloud;
    this.move(beat, animate && aloud);
    if (!animate) {
      this.timeline.seek(label, false);
      return;
    }
    // Start from the end of the previous beat, so a skipped-over state never shows.
    this.timeline.seek(beat > 0 ? this.labels[beat - 1]! : 0, false);
    const tween = this.timeline.tweenTo(label);
    tween.eventCallback('onComplete', () => {
      if (this.tween === tween) this.tween = null;
    });
    this.tween = tween;
  }

  /** Put the playhead part-way through the animation into a beat (0..1), for filmstrips. */
  sample(beat: number, progress: number) {
    this.finish();
    const start = beat > 0 ? this.timeline.labels[this.labels[beat - 1]!]! : 0;
    const end = this.timeline.labels[this.labels[beat]!]!;
    this.timeline.seek(start + (end - start) * progress, false);
  }

  /** How long the animation into a beat takes, in seconds. */
  duration(beat: number): number {
    const start = beat > 0 ? this.timeline.labels[this.labels[beat - 1]!]! : 0;
    return this.timeline.labels[this.labels[beat]!]! - start;
  }

  kill() {
    this.finish();
    for (const range of this.ranges) range.kill();
    this.timeline.kill();
  }
}
