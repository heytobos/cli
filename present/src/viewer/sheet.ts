import type { MediaEntry } from '@tobos/deck';
import type { ViewerConfig } from './config.ts';

/**
 * A contact sheet of a deck's media, for a chat to see what the person dropped on the deck's page
 * (TOB-343): the files the address's hash names (`#a.jpg/team%2Fada.png`), each whole in a tile,
 * with its name, and what it is under it: a picture's size in pixels, a video's frame from a tenth
 * in and its length, a sound's length, a font's letters. Each is fitted whole, never cropped, on a
 * grey checkerboard, so a white logo shows as well as a black one. The renderer takes it as one
 * JPEG. It runs no deck code, and is drawn apart from the master's styles, in a shadow root.
 */
export function showSheet(root: HTMLElement, config: ViewerConfig): Promise<void> {
  const names = location.hash
    .slice(1)
    .split('/')
    .filter(Boolean)
    .map((name) => decodeURIComponent(name));
  const host = document.createElement('div');
  host.style.cssText = 'position: fixed; inset: 0; z-index: 2147483647; background: #fff';
  root.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  const grid = document.createElement('div');
  grid.className = 'grid';
  const columns = COLUMNS[Math.min(names.length, COLUMNS.length - 1)]!;
  grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  grid.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(names.length / columns))}, minmax(0, 1fr))`;
  shadow.append(style, grid);
  const drawn = names.map((name) => {
    const entry = Object.hasOwn(config.manifest.media, name)
      ? config.manifest.media[name]
      : undefined;
    const tile = document.createElement('figure');
    const view = document.createElement('div');
    view.className = 'view';
    const caption = document.createElement('figcaption');
    const title = document.createElement('b');
    title.textContent = shortened(name);
    const about = document.createElement('span');
    caption.append(title, about);
    tile.append(view, caption);
    grid.append(tile);
    if (!entry) {
      about.textContent = 'not in media.json';
      return Promise.resolve();
    }
    const said = (what: string) => (about.textContent = [what, sizeText(entry.size)].join(' · '));
    said(entry.type);
    return within(drawFile(view, entry, said), 20_000).catch(() => {
      view.replaceChildren(note('can’t preview'));
      said(`${entry.type}, can’t be shown`);
    });
  });
  return Promise.all(drawn).then(() => undefined);
}

/** The columns of a sheet of so many files, from 1 to 12: as large as they fit, in its shape. */
const COLUMNS = [1, 1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];

const STYLE = `
.grid { position: absolute; inset: 0; display: grid; gap: 12px; padding: 16px;
  font: 15px/1.3 system-ui, sans-serif; color: #111; background: #fff }
figure { margin: 0; display: flex; flex-direction: column; min-height: 0; min-width: 0 }
.view { position: relative; flex: 1; min-height: 0; display: grid; place-items: center;
  overflow: hidden; border-radius: 6px;
  background: repeating-conic-gradient(#a8a8a8 0 25%, #c8c8c8 0 50%) 0 0 / 16px 16px }
.view > img, .view > video { position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: contain; display: block }
.view > p { margin: 0; padding: 4px 12px; text-align: center; color: #111; font-size: 20px;
  background: #fff; border-radius: 4px }
figcaption { padding-top: 4px; display: flex; flex-direction: column; white-space: nowrap; overflow: hidden }
figcaption b, figcaption span { overflow: hidden; text-overflow: ellipsis }
figcaption span { color: #555; font-size: 13px }
`;

/** A name long enough to be cut, cut in its middle: its start and its extension both say much. */
function shortened(name: string): string {
  return name.length <= 44 ? name : `${name.slice(0, 26)}…${name.slice(-16)}`;
}

function sizeText(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} kB`;
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'its length unknown';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
  ]);
}

/** Once `event` fires on `target`, or rejected on its error. */
const once = (target: EventTarget, event: string) =>
  new Promise<void>((resolve, reject) => {
    target.addEventListener(event, () => resolve(), { once: true });
    target.addEventListener('error', () => reject(new Error('error')), { once: true });
  });

/** One file drawn into its tile, and what it is said: done when it shows. */
async function drawFile(view: HTMLElement, entry: MediaEntry, said: (what: string) => void) {
  const url = `media/${entry.hash}`;
  const [kind] = entry.type.split('/');
  if (kind === 'image') {
    const img = document.createElement('img');
    img.src = url;
    view.append(img);
    await img.decode();
    const animated = entry.type === 'image/gif' ? ', animated maybe' : '';
    said(
      img.naturalWidth
        ? `${img.naturalWidth}×${img.naturalHeight}${animated}`
        : `${entry.type.slice(6).toUpperCase()}${animated}`,
    );
  } else if (kind === 'video') {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    view.append(video);
    await once(video, 'loadedmetadata');
    // A tenth in: the first frame is often black.
    const seeked = once(video, 'seeked');
    video.currentTime = Number.isFinite(video.duration) ? video.duration / 10 : 0;
    await seeked;
    said(`video, ${duration(video.duration)}, ${video.videoWidth}×${video.videoHeight}`);
  } else if (kind === 'audio') {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    view.append(note('♪ sound'));
    await once(audio, 'loadedmetadata');
    said(`sound, ${duration(audio.duration)}`);
  } else if (kind === 'font') {
    const face = new FontFace(`sheet-${entry.hash.slice(0, 12)}`, `url(${url})`);
    (document.fonts as unknown as { add(face: FontFace): void }).add(await face.load());
    const sample = note('Aa Bb Cc 0123');
    sample.style.fontFamily = face.family;
    sample.style.fontSize = '36px';
    sample.style.color = '#111';
    view.append(sample);
    said('font');
  } else {
    view.append(note(entry.type === 'application/pdf' ? 'PDF' : entry.type));
  }
}
