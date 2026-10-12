export type Severity = 'error' | 'warning';

/** One thing wrong with a deck. Lines and columns are 1-based. */
export interface Problem {
  file: string;
  line?: number;
  column?: number;
  rule: string;
  message: string;
  severity: Severity;
}

export interface DeckScene {
  id: string;
  title: string;
  /** A line about the scene, for the people working on the deck (a template's gallery shows it). */
  note?: string;
}

export interface DeckChapter {
  id: string;
  title: string;
  scenes: DeckScene[];
}

/** deck.json */
export interface DeckJson {
  title: string;
  chapters: DeckChapter[];
  dependencies?: Record<string, string>;
}

export interface MediaEntry {
  hash: string;
  size: number;
  type: string;
}

/** media.json: path inside media/ → the file's content hash. */
export type MediaJson = Record<string, MediaEntry>;

export interface ManifestScene {
  id: string;
  title: string;
  note?: string;
  beats: string[];
  /** The scene's specifier in the import map. */
  module: string;
}

export interface ManifestChapter {
  id: string;
  title: string;
  scenes: ManifestScene[];
}

/** What the viewer needs to show one revision of a deck. */
export interface Manifest {
  format: 1;
  title: string;
  chapters: ManifestChapter[];
  /**
   * Deck specifiers (`@deck/scenes/a.svelte`) → module paths relative to the viewer (`m/<hash>.js`).
   * The server adds the package specifiers once it has bundled them (`d3` → `p/<bundle>/d3.js`).
   */
  imports: Record<string, string>;
  media: MediaJson;
  /** deck.json's dependencies: package → exact version. */
  dependencies: Record<string, string>;
  /** The package specifiers the deck imports, by dependency: `{ three: ['three', 'three/addons/…'] }`. */
  packages: Record<string, string[]>;
  /**
   * Stylesheets, relative to the viewer: the master's tokens.css (`m/<hash>.css`), then those of
   * the packages it imports (`p/<bundle>/katex/dist/katex.min.css`), which the server adds.
   */
  styles?: string[];
}

/** A deck's files, from a directory or from a git revision. Paths use `/` and have no leading slash. */
export interface DeckTree {
  files(): string[];
  read(path: string): Uint8Array | undefined;
}
