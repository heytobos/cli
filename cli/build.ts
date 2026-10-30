/** Bundle the CLI into one file: the deck compiler included, so `tobos check` runs offline. */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { readTree, SKILL_NAME } from './src/skill.ts';

/**
 * The declarations of @tobos/present, generated from its source, so `tobos check --types` can
 * never describe an engine API that differs from the one the viewer runs: but for what is kept
 * only for revisions pushed before (`@internal`), and with what a deck writes of media/,
 * `$media` imports and `import.meta.glob`, as media.d.ts.
 */
function presentTypes(): Record<string, string> {
  const root = new URL('../present/src/', import.meta.url).pathname;
  // The deck format's types, which the engine's own name (Activity), go along as deck/types.d.ts.
  const deckTypes = new URL('../deck/src/types.ts', import.meta.url).pathname;
  const files: Record<string, string> = {};
  const program = ts.createProgram([`${root}index.ts`, deckTypes], {
    declaration: true,
    emitDeclarationOnly: true,
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2023,
    skipLibCheck: true,
    strict: true,
    stripInternal: true,
  });
  program.emit(undefined, (name, text) => {
    if (name.startsWith(root)) files[name.slice(root.length)] = text;
    else if (name === deckTypes.replace(/\.ts$/, '.d.ts')) files['deck/types.d.ts'] = text;
  });
  if (!files['index.d.ts'] || !files['deck/types.d.ts'])
    throw new Error('No declarations for @tobos/present.');
  files['media.d.ts'] = readFileSync(`${root}media.d.ts`, 'utf8');
  return files;
}

/**
 * What `tobos check --types` installs to check a deck: the versions installed here for the engine,
 * so they follow the workspace's, as the engine's types do.
 */
function toolchain(): Record<string, string> {
  const present = createRequire(new URL('../present/package.json', import.meta.url));
  const version = (name: string) => {
    for (const dir of present.resolve.paths(name) ?? []) {
      const file = join(dir, name, 'package.json');
      if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')).version as string;
    }
    throw new Error(`No ${name} installed for @tobos/present.`);
  };
  return Object.fromEntries(
    ['svelte-check', 'typescript', 'svelte', 'gsap'].map((name) => [name, version(name)]),
  );
}

const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
await esbuild.build({
  // The compiler in a file of its own, which only a command that checks loads (runCheck).
  entryPoints: { cli: 'src/main.ts' },
  outdir: 'dist',
  splitting: true,
  chunkNames: '[name]-[hash]',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['playwright-core'],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __tobosRequire } from 'node:module';\nconst require = __tobosRequire(import.meta.url);",
  },
  define: {
    TOBOS_VERSION: JSON.stringify(pkg.version),
    TOBOS_PRESENT_TYPES: JSON.stringify(presentTypes()),
    TOBOS_TOOLCHAIN: JSON.stringify(toolchain()),
    // The agent pack's skill, which `tobos skill install` writes into the person's harnesses.
    TOBOS_SKILL: JSON.stringify(
      readTree(new URL(`../agent-pack/skills/${SKILL_NAME}/`, import.meta.url).pathname),
    ),
  },
  legalComments: 'none',
  logLevel: 'warning',
});
// What `tobos` runs: Node keeps what it compiles of the CLI between runs, which takes a third of
// its start, from before the CLI loads, so that is kept too. Node before 22.1 has no such cache.
writeFileSync(
  'dist/tobos.js',
  "#!/usr/bin/env node\nimport module from 'node:module';\nmodule.enableCompileCache?.();\nawait import('./cli.js');\n",
);
chmodSync('dist/tobos.js', 0o755);
console.log('dist/tobos.js, dist/cli.js');
