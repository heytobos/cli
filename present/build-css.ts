/**
 * A runtime stylesheet with the system's tokens and classes inside it: its `@import`s of
 * @tobos/site (tokens.css, system.css) bundled in, the faces it names left to the runtime's
 * fonts/. The phone page's (phone.css) and the chrome's (viewer/chrome.css, scoped after by
 * chrome-style.ts) both come this way, so each takes the same files the same way.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

export async function bundledCss(entry: string, minify = false): Promise<string> {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    outdir: 'out',
    external: ['./fonts/*'],
    minify,
    absWorkingDir: root,
    logLevel: 'warning',
    legalComments: 'none',
  });
  return result.outputFiles[0]!.text;
}
