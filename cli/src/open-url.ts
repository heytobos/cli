import { spawn } from 'node:child_process';

/** Open a URL in the person's browser, if there is one. Never fails. */
export function openUrl(url: string): boolean {
  if (!process.stdout.isTTY || process.env.CI || process.env.TOBOS_NO_BROWSER) return false;
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  // Not `cmd /c start`: cmd would split the URL at `&`. rundll32 takes it as one argument.
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
