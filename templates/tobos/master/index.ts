/**
 * The deck's slide master: what scenes import from '../master/index.ts'. The guide for agents
 * is GUIDE.md.
 */
export { default as Title } from './layouts/Title.svelte';
export { default as Section } from './layouts/Section.svelte';
export { default as Content } from './layouts/Content.svelte';
export { default as Agenda } from './layouts/Agenda.svelte';
export { default as Blank } from './layouts/Blank.svelte';
export { default as Wayfinder } from './components/Wayfinder.svelte';
export { default as Quote } from './components/Quote.svelte';
export { default as Stat } from './components/Stat.svelte';
export { default as Chip } from './components/Chip.svelte';
export { default as Code } from './components/Code.svelte';
export { motion, ease, duration, focus } from './motion.ts';
export { grid, column } from './grid.ts';
