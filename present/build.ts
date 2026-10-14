/**
 * Build the runtime every viewer page loads: Svelte, GSAP and the engine, as ES modules
 * with shared chunks, so scenes and the engine share one Svelte. Output goes to
 * dist/runtime/<id>/, where <id> is a hash of the output, so URLs can be cached forever.
 */
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { compile, compileModule } from 'svelte/compiler';

const root = dirname(fileURLToPath(import.meta.url));
const tmp = join(root, 'dist/runtime-tmp');

const SVELTE = [
  'svelte',
  'svelte/animate',
  'svelte/attachments',
  'svelte/easing',
  'svelte/events',
  'svelte/internal/client',
  'svelte/internal/disclose-version',
  'svelte/internal/flags/async',
  'svelte/internal/flags/legacy',
  'svelte/internal/flags/tracing',
  'svelte/legacy',
  'svelte/motion',
  'svelte/reactivity',
  'svelte/reactivity/window',
  'svelte/store',
  'svelte/transition',
];
const GSAP_PLUGINS = readdirSync(join(root, 'node_modules/gsap'))
  .filter((f) => /^[A-Z].*\.js$/.test(f))
  .map((f) => f.slice(0, -3));

const entries: { in: string; out: string; specifiers: string[] }[] = [
  ...SVELTE.map((s) => ({ in: s, out: s, specifiers: [s] })),
  {
    in: 'gsap',
    out: 'gsap/index',
    specifiers: ['gsap', 'gsap/index.js', 'gsap/all', 'gsap/all.js'],
  },
  ...GSAP_PLUGINS.map((p) => ({
    in: `gsap/${p}`,
    out: `gsap/${p}`,
    specifiers: [`gsap/${p}`, `gsap/${p}.js`],
  })),
  { in: join(root, 'src/index.ts'), out: 'present', specifiers: ['@tobos/present'] },
  { in: join(root, 'src/viewer/index.ts'), out: 'viewer', specifiers: ['@tobos/present/viewer'] },
  // The phone page's script: our code, on a page of its own, sharing nothing with decks.
  { in: join(root, 'src/phone/phone.ts'), out: 'phone', specifiers: [] },
];

const sveltePlugin: esbuild.Plugin = {
  name: 'svelte',
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, (args) => {
      const source = readFileSync(args.path, 'utf8');
      const result = compile(source, {
        filename: args.path,
        css: 'injected',
        generate: 'client',
        discloseVersion: false,
      });
      return { contents: result.js.code, loader: 'js', resolveDir: dirname(args.path) };
    });
    build.onLoad({ filter: /\.svelte\.ts$/ }, async (args) => {
      const ts = readFileSync(args.path, 'utf8');
      const js = (await esbuild.transform(ts, { loader: 'ts' })).code;
      const result = compileModule(js, { filename: args.path, generate: 'client' });
      return { contents: result.js.code, loader: 'js', resolveDir: dirname(args.path) };
    });
  },
};

rmSync(tmp, { recursive: true, force: true });
await esbuild.build({
  entryPoints: entries.map((e) => ({ in: e.in, out: e.out })),
  outdir: tmp,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  minify: true,
  conditions: ['svelte', 'browser', 'production'],
  chunkNames: 'chunks/[hash]',
  absWorkingDir: root,
  plugins: [sveltePlugin],
  logLevel: 'warning',
  legalComments: 'none',
});
cpSync(join(root, 'src/viewer/viewer.css'), join(tmp, 'viewer.css'));
cpSync(join(root, 'src/phone/phone.css'), join(tmp, 'phone.css'));
// The presenter's faces, tobos.ai's own (viewer.css names them), with their licences.
const fonts = dirname(fileURLToPath(import.meta.resolve('@tobos/site/fonts.css')));
mkdirSync(join(tmp, 'fonts'));
for (const file of readdirSync(fonts).filter((f) => /-latin\.woff2$|\.txt$/.test(f)))
  cpSync(join(fonts, file), join(tmp, 'fonts', file));

// The runtime's ID is the hash of everything in it.
const hash = createHash('sha256');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
for (const file of walk(tmp).sort()) hash.update(relative(tmp, file)).update(readFileSync(file));
const id = hash.digest('hex').slice(0, 16);

const out = join(root, 'dist/runtime');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
renameSync(tmp, join(out, id));
const imports: Record<string, string> = {};
for (const entry of entries) for (const s of entry.specifiers) imports[s] = `${entry.out}.js`;
writeFileSync(
  join(out, 'runtime.json'),
  JSON.stringify({ id, imports, styles: ['viewer.css'] }, null, 2) + '\n',
);
console.log(`runtime ${id}: ${walk(join(out, id)).length} files`);
