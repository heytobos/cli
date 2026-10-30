// What a deck's code may write of media/, besides the engine's API: `tobos check --types`
// declares it beside the engine's types (cli/build.ts), as the build compiles it
// (deck/src/media-imports.ts).

/** A file of media/: its URL. `import cow from '$media/cow.jpg'` */
declare module '$media/*' {
  const url: string;
  export default url;
}

interface ImportMeta {
  /**
   * The files of media/ a pattern matches, `import.meta.glob('$media/cow/*.png')`: each file's
   * URL by its specifier (`'$media/cow/a.png'`), in order. `*` matches within a folder's name, a
   * `**` folder any number of folders. The pattern is a string literal, or an array of them.
   */
  glob(pattern: string | string[]): Record<string, string>;
}
