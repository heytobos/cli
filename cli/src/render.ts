/**
 * `tobos render`: a headless Chromium on this machine, pointed at the hosted viewer, so the agent
 * sees its work as viewers will. Deck code runs here, in viewers' browsers, and on Tobos's
 * renderer, which makes the stills and the PDFs (`tobos export pdf` downloads one).
 */
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CliError } from './out.ts';

type Browser = import('playwright-core').Browser;
type Page = import('playwright-core').Page;

interface TobosApi {
  /** In the print view, whether every page was fully drawn in time. */
  ready: Promise<unknown>;
  /** Whether the frame was fully drawn in time: one taken anyway is said to be late. */
  goto(hash: string): Promise<boolean>;
  sample(hash: string, progress: number): Promise<boolean>;
}

async function launch(): Promise<Browser> {
  let playwright: typeof import('playwright-core');
  try {
    playwright = await import('playwright-core');
  } catch {
    throw new CliError(
      'Rendering needs playwright-core. Reinstall the CLI: `npm i -g @tobos/cli`.',
    );
  }
  // Headless Chromium keeps its shared memory in TMPDIR. Where /tmp is a small tmpfs, a heavy
  // deck fills it and the tab crashes, so its temporary files go to the disk instead.
  const tmp = join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'tobos', 'chromium');
  mkdirSync(tmp, { recursive: true });
  const env = { ...process.env, TMPDIR: tmp } as Record<string, string>;
  // A browser named in TOBOS_BROWSER is the one to use: no other in its place.
  const executablePath = process.env.TOBOS_BROWSER;
  if (executablePath) {
    const named = await firstToLaunch([() => playwright.chromium.launch({ env, executablePath })]);
    if ('browser' in named) return named.browser;
    throw new CliError(`TOBOS_BROWSER (${executablePath}) didn't start: ${named.error}`);
  }
  const found = await firstToLaunch([
    () => playwright.chromium.launch({ env }),
    () => playwright.chromium.launch({ env, channel: 'chrome' }),
    () => playwright.chromium.launch({ env, channel: 'msedge' }),
  ]);
  if ('browser' in found) return found.browser;

  // None on this machine: fetch the one this playwright-core was built for, once.
  await installChromium();
  const installed = await firstToLaunch([() => playwright.chromium.launch({ env })]);
  if ('browser' in installed) return installed.browser;
  throw new CliError(
    `Chromium is installed but didn't start: ${installed.error}\n` +
      'On Linux it may need system libraries: `sudo npx playwright-core install-deps chromium`. ' +
      'Or point TOBOS_BROWSER at a Chrome or Chromium executable.',
  );
}

async function firstToLaunch(
  attempts: (() => Promise<Browser>)[],
): Promise<{ browser: Browser } | { error: string }> {
  let error = '';
  for (const attempt of attempts) {
    try {
      return { browser: await attempt() };
    } catch (e) {
      error = (e as Error).message.split('\n')[0] ?? '';
    }
  }
  return { error };
}

/**
 * Download the headless Chromium that this CLI's own playwright-core expects, into Playwright's
 * shared cache. `npx playwright install` would fetch the latest Playwright's revision instead,
 * which needn't be this one, and would remove other projects' browsers.
 */
async function installChromium(): Promise<void> {
  const pkg = createRequire(import.meta.url).resolve('playwright-core/package.json');
  const args = [join(dirname(pkg), 'cli.js'), 'install', '--only-shell', '--no-remove', 'chromium'];
  process.stderr.write(
    'No Chromium on this machine: installing one for rendering (once, ~100 MB)…\n',
  );
  await new Promise<void>((done, fail) =>
    execFile(process.execPath, args, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return done();
      const why = `${stderr}\n${stdout}`.trim().split('\n').filter(Boolean).at(-1) ?? error.message;
      fail(
        new CliError(
          `No Chromium to render with, and installing one failed: ${why}\n` +
            'It downloads from cdn.playwright.dev; a sandbox has to allow that host. ' +
            'Or point TOBOS_BROWSER at a Chrome or Chromium executable.',
        ),
      );
    }),
  );
  process.stderr.write('Chromium installed.\n');
}

/**
 * Open the viewer. `errors` collects what the deck throws, and what the viewer logs as failing,
 * such as a scene that didn't load. `ready` is what its start resolved to (TobosApi).
 */
async function openViewer(
  browser: Browser,
  url: string,
  scale: number,
  errors: string[] = [],
): Promise<{ page: Page; ready: unknown }> {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: scale,
  });
  page.setDefaultTimeout(30_000);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(() => '__tobos' in window, null, { timeout: 30_000 });
    const ready = await page.evaluate(
      () => (window as unknown as { __tobos: TobosApi }).__tobos.ready,
    );
    return { page, ready };
  } catch (error) {
    throw new CliError(`The viewer didn't start: ${errors[0] ?? (error as Error).message}`);
  }
}

export interface Rendered {
  position: string;
  path: string;
  frames?: string[];
  /** Taken before everything on screen was drawn in time: fonts, images or video frames. */
  late?: true;
}

const CRASHED = /crashed|Target closed|has been closed/i;

export async function renderBeats(
  url: string,
  positions: string[],
  options: { dir: string; film: boolean; frames: number; scale: number; note: (m: string) => void },
): Promise<{ files: Rendered[]; errors: string[] }> {
  mkdirSync(options.dir, { recursive: true });
  const errors: string[] = [];
  let browser = await launch();
  let { page } = await openViewer(browser, url, options.scale, errors);
  const files: Rendered[] = [];

  const renderOne = async (position: string): Promise<Rendered> => {
    const hash = `#${position}`;
    const base = position.replace('/', '--');
    if (!options.film) {
      const drawn = await page.evaluate(
        (h) => (window as unknown as { __tobos: TobosApi }).__tobos.goto(h),
        hash,
      );
      const path = join(options.dir, `${base}.png`);
      await page.screenshot({ path });
      return { position, path, ...(drawn ? {} : { late: true }) };
    }
    // A filmstrip: frames through the animation into the beat, side by side. The full-size
    // frames are kept too (`frames`), for reading small text.
    const count = Math.max(2, Math.min(options.frames, 12));
    const frames: string[] = [];
    let drawn = true;
    for (let i = 0; i < count; i++) {
      const sampled = await page.evaluate(
        ([h, p]) =>
          (window as unknown as { __tobos: TobosApi }).__tobos.sample(h as string, p as number),
        [hash, i / (count - 1)] as const,
      );
      drawn &&= sampled;
      const path = join(options.dir, `${base}--${i}.png`);
      await page.screenshot({ path });
      frames.push(path);
    }
    const strip = join(options.dir, `${base}--film.png`);
    await stripOf(browser, frames, strip);
    return { position, path: strip, frames, ...(drawn ? {} : { late: true }) };
  };

  try {
    for (const position of positions) {
      let rendered: Rendered;
      try {
        rendered = await renderOne(position);
      } catch (error) {
        if (!CRASHED.test((error as Error).message)) throw error;
        // A crashed tab: start a fresh browser and try this beat once more.
        options.note(`the browser crashed on ${position}; retrying`);
        await browser.close().catch(() => undefined);
        browser = await launch();
        ({ page } = await openViewer(browser, url, options.scale, errors));
        try {
          rendered = await renderOne(position);
        } catch (again) {
          if (!CRASHED.test((again as Error).message)) throw again;
          throw new CliError(
            `Chromium crashed twice rendering ${position}. It usually runs out of memory: ` +
              'check that the scene shows media at the size it is drawn, and that the machine has memory free.',
          );
        }
      }
      if (rendered.late)
        options.note(
          `${position} was taken before everything on it was drawn: fonts, images or video frames still loading`,
        );
      files.push(rendered);
      options.note(
        `rendered ${position}${rendered.frames ? ` (${rendered.frames.length} frames)` : ''}`,
      );
    }
    if (errors.length) options.note(`the deck threw while rendering: ${errors[0]}`);
    return { files, errors };
  } finally {
    await browser.close();
  }
}

/** Put frames in a row, 480px wide each, as one PNG. */
async function stripOf(browser: Browser, frames: string[], target: string) {
  const page = await browser.newPage({ viewport: { width: 488 * frames.length + 8, height: 286 } });
  const images = frames
    .map((f) => `<img src="data:image/png;base64,${readFileSync(f).toString('base64')}">`)
    .join('');
  await page.setContent(
    `<body style="margin:0;padding:8px;display:flex;gap:8px">${images}<style>img{width:480px;height:270px}</style></body>`,
  );
  await page.screenshot({ path: target });
  await page.close();
}
