/**
 * `tobos check --types`: TypeScript's view of a deck. Opt-in, because it needs a toolchain
 * (svelte-check, TypeScript, Svelte, GSAP and the deck's npm packages) that the everyday check
 * doesn't. The toolchain is installed once per set of versions into ~/.cache/tobos/types/, and
 * linked into the deck as node_modules (gitignored), so the deck itself stays free of it.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { parseDeckJson, type Problem } from '@tobos/deck';
import { CliError } from './out.ts';

declare const TOBOS_PRESENT_TYPES: Record<string, string>;
/** svelte-check, typescript, svelte and gsap, at the versions the engine is built with (build.ts). */
declare const TOBOS_TOOLCHAIN: Record<string, string>;

function run(command: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

/** The toolchain for these dependencies, installed if it isn't yet. */
async function toolchain(dependencies: Record<string, string>, note: (m: string) => void) {
  const wanted = { ...TOBOS_TOOLCHAIN, ...dependencies };
  const id = createHash('sha256').update(JSON.stringify(wanted)).digest('hex').slice(0, 16);
  const dir = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tobos', 'types', id);
  const complete = () => existsSync(join(dir, 'node_modules', 'svelte-check'));
  if (complete()) return dir;
  note('installing the type checker (once for these versions)…');
  // Into a folder of its own, moved into place once complete: a check installing the same
  // versions at the same time (another agent, another checkout's tests) never sees half of one.
  mkdirSync(dirname(dir), { recursive: true });
  const partial = mkdtempSync(`${dir}.`);
  writeFileSync(join(partial, 'package.json'), JSON.stringify({ private: true }) + '\n');
  const install = await run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      ...Object.entries(wanted).map(([name, version]) => `${name}@${version}`),
    ],
    partial,
  ).catch((error: Error) => ({ code: 1, out: error.message }));
  if (install.code !== 0) {
    rmSync(partial, { recursive: true, force: true });
    throw new CliError(`Couldn't install the type checker with npm:\n${install.out.trim()}`);
  }
  try {
    renameSync(partial, dir);
  } catch {
    if (complete()) {
      // Another check got there first.
      rmSync(partial, { recursive: true, force: true });
    } else {
      // An install from before, interrupted.
      rmSync(dir, { recursive: true, force: true });
      renameSync(partial, dir);
    }
  }
  return dir;
}

/** Link the toolchain's node_modules into the deck, unless the deck has a real one. */
function linkModules(root: string, dir: string) {
  const link = join(root, 'node_modules');
  if (existsSync(link) && !lstatSync(link).isSymbolicLink())
    throw new CliError(
      'This deck has its own node_modules/; remove it (a deck has no build step).',
    );
  rmSync(link, { force: true });
  symlinkSync(join(dir, 'node_modules'), link, 'dir');
  // `node_modules/` in .gitignore matches folders, not links: keep this one out of git too.
  const exclude = join(root, '.git', 'info', 'exclude');
  if (existsSync(join(root, '.git'))) {
    mkdirSync(dirname(exclude), { recursive: true });
    const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
    if (!/^\/?node_modules$/m.test(current))
      writeFileSync(
        exclude,
        `${current}${current && !current.endsWith('\n') ? '\n' : ''}/node_modules\n`,
      );
  }
}

function writeConfig(root: string): string {
  const dir = join(root, '.tobos', 'types');
  rmSync(dir, { recursive: true, force: true });
  for (const [file, text] of Object.entries(TOBOS_PRESENT_TYPES)) {
    const path = join(dir, 'present', file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  const rel = (path: string) => relative(dir, path).split('\\').join('/');
  const paths: Record<string, string[]> = {
    '@tobos/present': [rel(join(dir, 'present', 'index.d.ts'))],
    '@tobos/deck/types': [rel(join(dir, 'present', 'deck', 'types.d.ts'))],
  };
  const config = join(dir, 'tsconfig.json');
  writeFileSync(
    config,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2023', 'DOM', 'DOM.Iterable'],
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          skipLibCheck: true,
          verbatimModuleSyntax: true,
          types: [],
          paths,
        },
        include: [
          '../../scenes/**/*',
          '../../master/**/*',
          '../../lib/**/*',
          '../../data/**/*.json',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  return config;
}

/** svelte-check's machine output: `<time> ERROR "file" line:col "message"`. */
export function parseMachineOutput(output: string, root: string): Problem[] {
  const problems: Problem[] = [];
  for (const line of output.split('\n')) {
    const match = /^\d+ (ERROR|WARNING) "(.+?)" (\d+):(\d+) "(.*)"$/.exec(line.trim());
    if (!match) continue;
    const file = match[2]!.startsWith('/') ? relative(root, match[2]!) : match[2]!;
    // The engine's types, which this writes into .tobos/: their problems aren't the deck's.
    if (file.startsWith('.tobos/')) continue;
    let message = match[5]!;
    try {
      message = JSON.parse(`"${message}"`);
    } catch {
      // keep it as written
    }
    problems.push({
      file,
      line: Number(match[3]),
      column: Number(match[4]),
      rule: 'types',
      message: message.split('\n')[0]!,
      severity: match[1] === 'ERROR' ? 'error' : 'warning',
    });
  }
  return problems;
}

export async function checkTypes(root: string, note: (m: string) => void): Promise<Problem[]> {
  if (typeof TOBOS_PRESENT_TYPES === 'undefined' || typeof TOBOS_TOOLCHAIN === 'undefined')
    throw new CliError(
      "--types needs the built CLI (dist/tobos.js), which carries the engine's types and toolchain.",
    );
  const { deck } = parseDeckJson(readFileSync(join(root, 'deck.json'), 'utf8'));
  if (!deck) return [];
  const dir = await toolchain(deck.dependencies ?? {}, note);
  linkModules(root, dir);
  const config = writeConfig(root);
  const result = await run(
    process.execPath,
    [
      join(dir, 'node_modules', 'svelte-check', 'bin', 'svelte-check'),
      '--tsconfig',
      config,
      '--workspace',
      root,
      '--output',
      'machine',
      '--threshold',
      'warning',
    ],
    root,
  );
  return typeProblems(result, root);
}

/**
 * The problems svelte-check found, and if it didn't finish, or failed without saying why in
 * problems, that: a check that couldn't run hasn't passed.
 */
export function typeProblems(result: { code: number; out: string }, root: string): Problem[] {
  const problems = parseMachineOutput(result.out, root);
  const completed = /^\d+ COMPLETED /m.test(result.out);
  if (completed && (result.code === 0 || problems.some((p) => p.severity === 'error')))
    return problems;
  const said = result.out.trim().split('\n').slice(-5).join('\n');
  return [
    ...problems,
    {
      file: 'deck.json',
      rule: 'types',
      message: `The type checker didn't finish (exit code ${result.code})${said ? `:\n${said}` : '.'}`,
      severity: 'error',
    },
  ];
}
