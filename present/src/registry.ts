/** State the viewer sets up before any scene loads, and the scene API reads. */

let files: Record<string, { hash: string }> = {};

export function setMedia(media: Record<string, { hash: string }>) {
  files = media;
}

export function mediaUrl(name: string): string {
  const entry = files[name];
  if (!entry) {
    console.warn(`[tobos] media("${name}") is not in media.json`);
    return '';
  }
  return 'media/' + entry.hash;
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
