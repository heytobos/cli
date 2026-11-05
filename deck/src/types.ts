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

/** A scene's place in the outline: its id, which is its file's name, its title and whether it shows. */
export interface OutlineScene {
  id: string;
  title: string;
  /** Left out of presenting, the share link and its PDF; still on the deck's page. */
  hidden?: true;
}

export interface OutlineChapter {
  id: string;
  title: string;
  scenes: OutlineScene[];
}

/**
 * A deck's outline: its title, and its chapters and their scenes in order (ADR 0006). Data, held
 * by Tobos, never a file of the deck; Tobos's own decks keep theirs in `outline.json` in the
 * codebase, in this shape.
 */
export interface Outline {
  title: string;
  chapters: OutlineChapter[];
}

/** deck.json: what the deck's code needs, its packages. The outline isn't in it (ADR 0006). */
export interface DeckJson {
  dependencies?: Record<string, string>;
}

export interface MediaEntry {
  hash: string;
  size: number;
  type: string;
}

/** media.json: path inside media/ → the file's content hash. */
export type MediaJson = Record<string, MediaEntry>;

/** A multiple-choice poll: each phone picks one option; its result shows from `reveals` on. */
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

/** An open-text poll: each phone fills in its fields. The answers are only stored. */
export interface TextActivity {
  id: string;
  kind: 'text';
  prompt?: string;
  fields: TextField[];
}

/**
 * A poll: what a scene asks the room, who answer on their phones (the format's `activity`). It
 * is open while the deck is presented on its scene, up to its `reveals` beat.
 */
export type Activity = ChoiceActivity | TextActivity;

/** A scene as the build has it: what its file is, whether or not the outline places it. */
export interface BuildScene {
  beats: string[];
  /** The scene's specifier in the import map. */
  module: string;
  activity?: Activity;
}

export interface ManifestScene extends BuildScene {
  id: string;
  title: string;
  /** Left out of presenting, the share link and its PDF (the outline's `hidden`). */
  hidden?: true;
}

export interface ManifestChapter {
  id: string;
  title: string;
  scenes: ManifestScene[];
}

/**
 * What a build makes of one revision of a deck, which the server stores with it: every scene file
 * by its id, placed or not, and what the viewer loads. The outline isn't part of it: it is joined
 * in when a manifest is read (joinOutline). Format 1's modules call the engine's media(); a later
 * one's import media (`import cow from '$media/cow.jpg'`), compiled into lookups of the same media
 * map. A revision keeps the format it was pushed with.
 */
export interface Build {
  format: 1 | 2;
  /** Each top-level `scenes/<id>.svelte` that exports beats, by its id. */
  scenes: Record<string, BuildScene>;
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
   * What the deck's code uses of the deck, so a share gets only what the scenes it shows reach,
   * and only what is on a slide must be on the server (share.ts). A manifest pushed before the build recorded it
   * had it written in afterwards, as its build then would have (TOB-397).
   */
  uses: Uses;
}

/**
 * A build stored before the outline left deck.json (ADR 0006): the scenes deck.json listed, in
 * its chapters, and its title, instead of `scenes`. Read as a build (buildScenes), its outline
 * being the deck's now.
 */
export type LegacyBuild = Omit<Build, 'scenes'> & { title: string; chapters: ManifestChapter[] };

/** A build as the server may have stored it: from now on, or from before ADR 0006. */
export type StoredBuild = Build | LegacyBuild;

/**
 * What the viewer needs to show one revision of a deck: its build, with the deck's outline as it
 * is now joined in (joinOutline). Only the scenes both have are in it.
 */
export type Manifest = Omit<Build, 'scenes'> & { title: string; chapters: ManifestChapter[] };

/** A manifest as a share link has it: what its modules use isn't part of it (share.ts). */
export type SharedManifest = Omit<Manifest, 'uses'>;

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
