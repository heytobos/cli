/**
 * How things move: one feel for every scene. Motion eases the eye and steers
 * attention; it never decorates. Use these presets in a beat's enter:
 *
 *   enter: (tl, q) => tl.from(q('[data-part=answer]'), { ...motion.enter, opacity: 0, y: 24 })
 *
 * Things arrive as they do on tobos.ai: on its curve, cubic-bezier(.22, .61, .24, 1).
 */
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

gsap.registerPlugin(CustomEase);

export const duration = { fast: 0.3, base: 0.6, slow: 1.2 } as const;

export const ease = {
  /** Things arriving: fast out of the gate, settling gently. */
  enter: CustomEase.create('tobos', '.22,.61,.24,1'),
  /** Things leaving: gathering speed. */
  exit: 'power2.in',
  /** Things moving from one place to another. */
  move: 'power2.inOut',
  /** A short emphasis, no overshoot. */
  emphasis: 'power1.inOut',
} as const;

export const motion = {
  enter: { duration: duration.base, ease: ease.enter },
  exit: { duration: duration.fast, ease: ease.exit },
  move: { duration: duration.base, ease: ease.move },
  emphasis: { duration: duration.fast, ease: ease.emphasis },
  /** Seconds between items that arrive one after another. */
  stagger: 0.08,
} as const;

/** Opacities for what is not the point right now. */
export const focus = { dim: 0.25, muted: 0.55 } as const;
