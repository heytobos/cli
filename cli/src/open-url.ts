import { spawn } from 'node:child_process';

/**
 * Open a web page in the person's browser, if there is one. Never fails. An agent's shell is no
 * terminal, so that is no reason not to; a session over SSH, or Linux without a display, is.
 */
export async function openUrl(url: string): Promise<boolean> {
  // A web page, nothing else: the opener would run whatever a URL of another scheme names.
  if (!/^https?:$/.test(URL.parse(url)?.protocol ?? '')) return false;
  const env = process.env;
  if (env.CI || env.TOBOS_NO_BROWSER || env.SSH_CONNECTION) return false;
  if (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
  // Not `cmd /c start`: cmd would split the URL at `&`. rundll32 takes it as one argument.
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
    // A missing opener fails only after spawn returns, and xdg-open with nothing to open exits
    // non-zero: either way the caller prints the URL. One still running after a moment opened it.
    return await new Promise<boolean>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const done = (opened: boolean) => {
        clearTimeout(timer);
        resolve(opened);
      };
      child.once('error', () => done(false));
      child.once('exit', (code) => done(code === 0));
      child.once('spawn', () => (timer = setTimeout(() => done(true), 1500)));
    });
  } catch {
    return false;
  }
}
