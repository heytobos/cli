/** State the viewer sets up before any scene loads, and the scene API reads. */
import { globMatcher } from '@tobos/deck/media-pattern';

let files: Record<string, { hash: string }> = {};

export function setMedia(media: Record<string, { hash: string }>) {
  files = media;
}

/** The URL of a file in media/, what `import cow from '$media/cow.jpg'` gives. */
export function mediaUrl(name: string): string {
  // Only its own names: `constructor` is a file like any other, not Object's.
  const entry = Object.hasOwn(files, name) ? files[name] : undefined;
  if (!entry) {
    // A share has only the files the check saw the scenes it shows use (sharedManifest): a file
    // missing there may well be in media.json.
    console.warn(
      isShared()
        ? `[tobos] media/${name} isn't available here`
        : `[tobos] media/${name} is not in media.json`,
    );
    return '';
  }
  return 'media/' + entry.hash;
}

/**
 * What `import.meta.glob('$media/cow/*.png')` gives: each file of media/ a pattern matches, by its
 * specifier (`$media/cow/a.png`), in order, with its URL. On a share, only those it has.
 */
export function mediaGlob(patterns: string[]): Record<string, string> {
  const matchers = patterns.map(globMatcher);
  const names = Object.keys(files)
    .filter((name) => matchers.some((matches) => matches(name)))
    .sort();
  return Object.fromEntries(names.map((name) => [`$media/${name}`, 'media/' + files[name]!.hash]));
}

/** The deck's join code, and the ways to show it. */
export interface JoinInfo {
  /** The six digits: `482913`. */
  code: string;
  /** The link as people type it, without the scheme: `tobosusercontent.com/482913`. */
  link: string;
  /** The full URL the QR code holds: `https://tobosusercontent.com/482913`. */
  url: string;
  /** The QR code, black on white, as an image's address: `<img src={join.qr} />`. */
  qr: string;
}

let join: JoinInfo | undefined;

export function setJoin(info: JoinInfo | undefined) {
  join = info;
}

export function joinInfo(): JoinInfo | undefined {
  return join;
}

let shared = false;

/** Whether this is a share link's page, for people outside the deck's account. */
export function setShared(value: boolean) {
  shared = value;
}

export function isShared(): boolean {
  return shared;
}
