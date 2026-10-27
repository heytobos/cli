/** Sound as it was recorded, five to ten times the size of AAC that a room hears no difference from. */
const LOSSLESS = /\.(wav|aiff?|flac)$/i;

/** A path as a shell takes it as one word: quoted where it has anything but plain characters. */
const shellWord = (path: string) =>
  /^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

/**
 * What `tobos push` says about a file in media/ that every viewer would download more of than it
 * needs: lossless sound over 1 MB, with the ffmpeg line that makes it AAC, and any file over 25 MB.
 */
export function sizeNote(name: string, size: number): string | undefined {
  const mb = Math.round(size / 1_000_000);
  if (LOSSLESS.test(name) && size > 1_000_000) {
    const from = shellWord(`media/${name}`);
    const to = shellWord(`media/${name.replace(LOSSLESS, '.m4a')}`);
    return `note: media/${name} is lossless sound, ${mb} MB. As AAC it takes a fraction of that, and sounds the same in a room: ffmpeg -i ${from} -c:a aac -b:a 128k ${to}`;
  }
  if (size > 25_000_000)
    return `note: media/${name} is ${mb} MB. Every viewer downloads it; size it for the stage.`;
  return undefined;
}
