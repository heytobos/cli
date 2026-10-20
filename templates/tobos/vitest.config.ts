// The tests render the master's layouts, so Svelte compiles them here as it does in a deck. Not
// what a test compiled itself into node_modules/.cache (#126's agenda.test.ts): that is compiled.
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte({ experimental: { compileModule: { exclude: [/\/node_modules\//] } } })],
});
