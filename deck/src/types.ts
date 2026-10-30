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

/** A poll: each phone picks one option. Its result shows on the projector from `reveals` on. */
export interface ChoiceActivity {
  id: string;
  kind: 'choice';
  prompt: string;
  options: string[];
  /** The beat of its scene that closes the poll and shows its result. */
  reveals?: string;
}

export interface TextField {
  id: string;
  label: string;
  multiline?: boolean;
  /** The most characters it takes. 500 unless the scene says otherwise; in a manifest, always set. */
  max?: number;
}

/** A form: each phone fills in its fields. The answers are only stored. */
export interface TextActivity {
  id: string;
  kind: 'text';
  prompt?: string;
  fields: TextField[];
}

/**
 * Something the room responds to on their phones, declared by a scene. It is open while the
 * deck is presented on its scene, up to its `reveals` beat.
 */
export type Activity = ChoiceActivity | TextActivity;

export interface ManifestScene {
  id: string;
  title: string;
  beats: string[];
  /** The scene's specifier in the import map. */
  module: string;
  activity?: Activity;
}

export interface ManifestChapter {
  id: string;
  title: string;
  scenes: ManifestScene[];
}

/**
 * What the viewer needs to show one revision of a deck. Format 1's modules call the engine's
 * media(); a later one's import media (`import cow from '$media/cow.jpg'`), compiled into lookups
 * of the same media map. A revision keeps the format it was pushed with.
 */
export interface Manifest {
  format: 1 | 2;
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
  /**
   * What the deck's code uses of the deck, so a share gets only what the scenes it shows reach
   * (share.ts). Not in a manifest pushed before the build recorded it, which sharedManifest()
   * shares as it did then.
   */
  uses?: Uses;
}

/** What each of a deck's modules uses of the deck itself, and what its stylesheet does. */
export interface Uses {
  /**
   * By specifier (`@deck/scenes/a.svelte`): the deck's modules it imports, statically or not; the
   * media.json names it imports; and its `import.meta.glob` patterns (`frames/*.png`), or in format
   * 1 its media() calls' (share.ts), which a share matches against media.json, so a pattern is here
   * once, not as every name it matches. Each is left out when it has none.
   */
  modules: Record<string, { imports?: string[]; media?: string[]; patterns?: string[] }>;
  /** The media.json names tokens.css links, which every page that shows the deck loads. */
  styles: string[];
}

/** A deck's files, from a directory or from a git revision. Paths use `/` and have no leading slash. */
export interface DeckTree {
  files(): string[];
  read(path: string): Uint8Array | undefined;
}
