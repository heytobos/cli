/**
 * The chrome's stylesheet: tobos.ai's tokens and classes (@tobos/site's tokens.css and system.css,
 * which chrome.css imports and build-css.ts bundles in, before its own rules) for what the viewer
 * draws around a deck, the presenter's view, a share link's bar, the hints and the media sheet, and
 * for nothing of the deck's own. build.ts writes it into the runtime as system.css.
 *
 * Every rule is under `@scope (.tobos-chrome) to (.tobos-stage)`: it matches only inside an
 * element marked as chrome, and never in a slide. The tokens are set on those elements, and none
 * of them holds a slide, so a scene inherits none of them either: a deck's look is the deck's. A
 * selector in @scope reaches only below its root, so `.on-ink`, which marks the root itself,
 * becomes `:where(:scope).on-ink`, as specific as it is in the app. The rules weigh as they read,
 * by specificity, as in the app: a chrome's own rule (Presenter.svelte's, scoped by Svelte, or
 * viewer.css's, later) wins over them, and a master's rule for every `button` doesn't. Not a
 * layer, which any rule outside one would win over. Keyframes go outside the scope, as @scope
 * holds only style rules, under names of their own.
 */
export function chromeStylesheet(bundled: string): string {
  let css = uncommented(bundled)
    .replace(/:root\b/g, ':scope')
    .replace(/\.on-ink(?![\w-])/g, ':where(:scope).on-ink');
  // A keyframes' name is the page's, a deck's too: the chrome's are named apart.
  for (const [, name] of css.matchAll(/@keyframes\s+([\w-]+)/g))
    css = css.replace(new RegExp(`(?<![\\w-])${name}(?![\\w-])`, 'g'), `tobos-chrome-${name}`);
  const keyframes: string[] = [];
  let rules = '';
  let at = 0;
  for (const match of css.matchAll(/@keyframes\s+[\w-]+\s*\{/g)) {
    if (match.index < at) continue;
    const end = closing(css, match.index + match[0].length - 1);
    rules += css.slice(at, match.index);
    keyframes.push(css.slice(match.index, end + 1));
    at = end + 1;
  }
  rules += css.slice(at);
  return [...keyframes, '@scope (.tobos-chrome) to (.tobos-stage) {', rules.trim(), '}', ''].join(
    '\n',
  );
}

const uncommented = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Where the brace opened at `open` closes. */
function closing(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  throw new Error(`An unclosed { at ${open}.`);
}
