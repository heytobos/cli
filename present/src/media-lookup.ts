/**
 * `@tobos/present/media`: what a deck's `import cow from '$media/cow.jpg'` and
 * `import.meta.glob('$media/cow/*.png')` compile to (deck/src/media-imports.ts), lookups in the
 * media map the viewer sets. Not in the engine's types: a deck writes the imports.
 */
export { mediaGlob, mediaUrl } from './registry.ts';
