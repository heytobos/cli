/**
 * Node side: where the built runtime is, and the viewer page that loads a deck. The app's
 * server uses it (app/src/lib/server/viewer.ts).
 */
import { readFileSync, statSync } from 'node:fs';
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
  } catch (cause) {
    throw new Error('The viewer runtime is not built. Run `pnpm --filter @tobos/present build`.', {
      cause,
    });
  }
  return { ...info, dir: join(root, 'dist/runtime', info.id) };
}

let current: { at: number; runtime: Runtime } | undefined;
/**
 * The runtime as last built, read again when a build replaces runtime.json: a server that runs
 * through a rebuild (a checkout's) serves the new one to the pages it serves from then on.
 */
export function currentRuntime(): Runtime {
  let at = 0;
  try {
    at = statSync(join(root, 'dist/runtime/runtime.json')).mtimeMs;
  } catch {
    // not built: loadRuntime says so
  }
  if (current?.at !== at) current = { at, runtime: loadRuntime() };
  return current.runtime;
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
  /** The tab's icon, a URL: the app's gives Tobos's, so a deck's tab is ours, a share link's too. */
  icon?: string;
  /**
   * Where the relative URLs go instead of beside the page: a window's capability, when the link
   * in the address bar opens once. The tab keeps it, for a reload (the app's content.ts).
   */
  base?: string;
  /**
   * A page meant to be found and shared, as the tour on tobos.ai is: search engines may list it,
   * and a link to it shows a preview with this description and image. Every other page, a deck's
   * or a share link's, stays unlisted.
   */
  listed?: { description: string; url: string; image: string };
}

/** What a listed page says to search engines and to a link's preview. */
const listing = ({ description, url, image }: NonNullable<ViewerPage['listed']>) =>
  [
    `<meta name="description" content="${escapeHtml(description)}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    '<meta property="og:type" content="website">',
    '<meta property="og:site_name" content="Tobos">',
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
  ].join('\n') + '\n';

export function viewerHtml(page: ViewerPage): string {
  const importMap = { imports: page.imports };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${
  page.base
    ? `<base href="${escapeHtml(page.base)}">
<script>try { for (const at of [location.pathname, new URL(document.baseURI).pathname]) sessionStorage.setItem('tobos:' + at, document.baseURI); } catch {}</script>
`
    : ''
}<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page.listed ? listing(page.listed) : '<meta name="robots" content="noindex">\n'}<title>${escapeHtml(page.title)}</title>
${page.icon ? `<link rel="icon" href="${escapeHtml(page.icon)}">\n` : ''}<meta property="og:title" content="${escapeHtml(page.title)}">
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
