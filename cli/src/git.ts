import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { settings } from './config.ts';
import { CliError } from './out.ts';

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run git. `echo` passes its stderr through (push progress, the server's messages). */
export function git(
  args: string[],
  options: { cwd?: string; echo?: boolean; env?: Record<string, string> } = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: options.cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env },
    });
    let stdout = '';
    let stderr = '';
    // Decoded as streams, so a character split between two chunks stays whole.
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (stdout += d));
    child.stderr.on('data', (d: string) => {
      stderr += d;
      if (options.echo) process.stderr.write(d);
    });
    child.on('error', (error) =>
      reject(
        (error as NodeJS.ErrnoException).code === 'ENOENT'
          ? new CliError('git is not installed. Tobos keeps every deck in git; install it first.')
          : error,
      ),
    );
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function gitOk(
  args: string[],
  options: Parameters<typeof git>[1] = {},
): Promise<string> {
  const result = await git(args, options);
  if (result.code !== 0) throw new CliError(`git ${args[0]} failed:\n${result.stderr.trim()}`);
  return result.stdout;
}

/**
 * How git asks us for the token: this CLI is the credential helper for the Tobos server,
 * so the token never sits in .git/config or a URL. Git starts the helper to store and erase too,
 * after each request, which it has nothing to do for: only `get` starts Node, a quarter second
 * each.
 */
export function credentialHelper(): string {
  const script = realpathSync(process.argv[1]!);
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return `!f() { [ "$1" = get ] || exit 0; exec ${quote(process.execPath)} ${quote(script)} credential get; }; f`;
}

/** Git config arguments that make git ask only us for the server's credentials. */
export function credentialConfig(server: string): string[] {
  return [
    '-c',
    `credential.${server}.helper=`,
    '-c',
    `credential.${server}.helper=${credentialHelper()}`,
  ];
}

/**
 * The token on git's first request, for the git this CLI runs itself. Without it git gets a 401,
 * then starts this CLI as its helper twice (get, then store): over half a second a push. In the
 * environment rather than `-c`, so it isn't in the process list.
 */
export function authEnv(server: string): Record<string, string> {
  const { server: ours, token } = settings();
  if (!token || new URL(ours).origin !== new URL(server).origin) return {};
  const n = Number(process.env.GIT_CONFIG_COUNT) || 0;
  return {
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: `http.${server}.extraHeader`,
    [`GIT_CONFIG_VALUE_${n}`]: `Authorization: Basic ${Buffer.from(`tobos:${token}`).toString('base64')}`,
  };
}

/**
 * The helper a deck's .git/config names, set again if it isn't this CLI as it runs now: written at
 * clone, it names Node and the CLI where they were then, and plain `git pull` uses it too, which
 * stops working once Node is upgraded. A deck it was never written into is left alone.
 */
export async function refreshCredentials(dir: string, server: string) {
  // The deck's own, not one the person set for everything: that one is theirs to keep.
  const configured = await git(['config', '--local', '--get-all', `credential.${server}.helper`], {
    cwd: dir,
  });
  if (configured.code !== 0) return;
  if (configured.stdout === `\n${credentialHelper()}\n`) return;
  await configureCredentials(dir, server);
}

export async function configureCredentials(dir: string, server: string) {
  await gitOk(['config', '--replace-all', `credential.${server}.helper`, ''], { cwd: dir });
  await gitOk(['config', '--add', `credential.${server}.helper`, credentialHelper()], { cwd: dir });
}
