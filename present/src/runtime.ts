/**
 * Node side: where the built runtime is, and the viewer page that loads a deck.
 * Used by the server, by exports, and by the dev preview.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ViewerConfig } from './viewer/config.ts';

export interface Runtime {
  id: string;
  /** Directory with the runtime's files. */
  dir: string;
  /** Specifier → path inside dir. */
  imports: Record<string, string>;
  styles: string[];
}

// Resolved through the package, so it still works when a bundler has moved this code.
const root = dirname(createRequire(import.meta.url).resolve('@tobos/present/package.json'));

export function loadRuntime(): Runtime {
  const file = join(root, 'dist/runtime/runtime.json');
  let info: Omit<Runtime, 'dir'>;
  try {
    info = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new Error('The viewer runtime is not built. Run `pnpm --filter @tobos/present build`.');
  }
  return { ...info, dir: join(root, 'dist/runtime', info.id) };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// JSON inside <script>: keep `</script>` and HTML comments from ending it.
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export interface ViewerPage {
  title: string;
  /** The full import map: runtime, deck and dependencies, with URLs relative to the page. */
  imports: Record<string, string>;
  /** Stylesheets, relative to the page. */
  styles: string[];
  config: ViewerConfig;
}

export function viewerHtml(page: ViewerPage): string {
  const importMap = { imports: page.imports };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<title>${escapeHtml(page.title)}</title>
<meta property="og:title" content="${escapeHtml(page.title)}">
<script type="importmap">${scriptJson(importMap)}</script>
${page.styles.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('\n')}
${Object.values(page.imports)
  .filter((url) => /\/(viewer|present)\.js$/.test(url))
  .map((url) => `<link rel="modulepreload" href="${escapeHtml(url)}">`)
  .join('\n')}
</head>
<body>
<div id="tobos"></div>
<script type="module">
import { start } from '@tobos/present/viewer';
start(${scriptJson(page.config)});
</script>
</body>
</html>
`;
}
