/** Bundle the CLI into one file: the deck compiler included, so `tobos check` runs offline. */
import { chmodSync, readFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import ts from 'typescript';
import { readTree, SKILL_NAME } from './src/skill.ts';

/**
 * The declarations of @tobos/present, generated from its source, so `tobos check --types` can
 * never describe an engine API that differs from the one the viewer runs.
 */
function presentTypes(): Record<string, string> {
  const root = new URL('../present/src/', import.meta.url).pathname;
  const files: Record<string, string> = {};
  const program = ts.createProgram([`${root}index.ts`], {
    declaration: true,
    emitDeclarationOnly: true,
    allowImportingTsExtensions: true,
    rewriteRelativeImportExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2023,
    skipLibCheck: true,
    strict: true,
  });
  program.emit(undefined, (name, text) => {
    if (name.startsWith(root)) files[name.slice(root.length)] = text;
  });
  if (!files['index.d.ts']) throw new Error('No declarations for @tobos/present.');
  return files;
}

const pkg = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8'));
await esbuild.build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/tobos.js',
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
    // The agent pack's skill, which `tobos skill install` writes into the person's harnesses.
    TOBOS_SKILL: JSON.stringify(
      readTree(new URL(`../agent-pack/skills/${SKILL_NAME}/`, import.meta.url).pathname),
    ),
  },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync('dist/tobos.js', 0o755);
console.log('dist/tobos.js');
