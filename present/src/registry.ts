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
