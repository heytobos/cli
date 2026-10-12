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
 * One scene's beats as one paused GSAP timeline, with a label after each beat's animation.
 * Stepping forward tweens the playhead to the next label; everything else seeks.
 */
export class SceneTimeline {
  readonly timeline: gsap.core.Timeline;
  private labels: string[] = [];
  private tween: gsap.core.Tween | null = null;

  constructor(root: Element, beats: readonly Beat[]) {
    const q: Query = (selector) => Array.from(root.querySelectorAll(selector));
    this.timeline = gsap.timeline({ paused: true });
    scenes.set(this.timeline, this);
    beats.forEach((beat, index) => {
      beat.enter?.(this.timeline, q);
      // Labels are namespaced so a beat called "start" can't collide with GSAP's own words.
      const label = `beat:${index}`;
      this.timeline.addLabel(label);
      this.labels.push(label);
    });
    this.timeline.seek(0, false);
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
  }

  /** Show a beat: play the animation into it, or land on its end state. */
  show(beat: number, animate: boolean) {
    const label = this.labels[Math.max(0, Math.min(beat, this.labels.length - 1))]!;
    this.finish();
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
    this.timeline.kill();
  }
}
