/**
 * What a CSS value writes by hand: its colours, its font family, its lengths. Read from one
 * declaration's value at a time, as the Svelte parser gives it, so nothing here reads a whole
 * stylesheet. What a value takes from a variable, `var(--stage-ink)`, isn't written by hand, and
 * neither is a `var()`'s fallback. Each part of a value is scanned once: these read what anyone
 * can push, on the server.
 */

/** The CSS-wide keywords, which are no value of their own. */
const KEYWORDS = new Set(['inherit', 'initial', 'unset', 'revert', 'revert-layer']);

/** CSS's named colours (CSS Color 4), but transparent and currentColor, which are no colour. */
const NAMED = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
  ).split(' '),
);

/** Properties whose words may be a colour's name: `border: 2px solid red`. */
const NAMES_COLOUR = /color|background|border|outline|fill|stroke|shadow|decoration|column-rule/;

/** The generic families, which end a font stack. */
const GENERIC =
  /(?<![\w-])(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong)(?![\w-])/i;

const FUNCTION = (names: string) => new RegExp(`(?<![\\w-])(?:${names})\\(`, 'gi');
const COLOUR_FUNCTION = FUNCTION('rgba?|hsla?|hwb|lab|lch|oklab|oklch|color');
const HEX = /#([0-9a-f]+)(?![\w-])/gi;
/** A length in px or rem; digits then a fraction, so no two parts take the same characters. */
const LENGTH = /(?<![\w.#-])(-?(?:\d+(?:\.\d+)?|\.\d+))(px|rem)(?![\w%-])/gi;

/** Where the parenthesis opened before `from` closes, or the value's end. */
function closing(value: string, from: number): number {
  let depth = 1;
  for (let i = from; i < value.length; i++) {
    if (value[i] === '(') depth++;
    else if (value[i] === ')' && --depth === 0) return i + 1;
  }
  return value.length;
}

/** A declaration's priority, `!important`, which says nothing of its value. */
const PRIORITY = /!\s*important\s*$/i;

/** The value without its priority. */
const valueOf = (value: string) => value.replace(PRIORITY, '');

/** The value without its priority, and its comments blanked, each a space. */
function bare(written: string): string {
  const value = valueOf(written);
  let text = '';
  for (let i = 0; i < value.length;) {
    const comment = value.indexOf('/*', i);
    const end = comment < 0 ? value.length : comment;
    text += value.slice(i, end);
    if (comment < 0) break;
    const close = value.indexOf('*/', comment + 2);
    text += ' ';
    i = close < 0 ? value.length : close + 2;
  }
  return text;
}

/**
 * The value bare, and the calls to `names` blanked, each a space: what it takes from variables,
 * and the addresses it names.
 */
function without(written: string, names = 'var|url|env'): string {
  const text = bare(written);
  let out = '';
  let last = 0;
  const pattern = FUNCTION(names);
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    out += text.slice(last, match.index) + ' ';
    last = closing(text, match.index + match[0].length);
    pattern.lastIndex = last;
  }
  return out + text.slice(last);
}

/**
 * A value's parts, split at each character `at` says, outside parentheses and quotes, so
 * `var(--a, Arial), serif` by commas is two. A slash is a part of its own: `40px/1.2`.
 */
function partsOf(text: string, at: (char: string) => boolean): string[] {
  const parts: string[] = [];
  let part = '';
  let depth = 0;
  let quote = '';
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && at(char)) {
      parts.push(part, char === '/' ? '/' : '');
      part = '';
      continue;
    }
    part += char;
  }
  parts.push(part);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Whether a part is a variable and nothing else: `var(--stage-font-text)`. */
const isVariable = (part: string) => /^var\(/i.test(part) && closing(part, 4) === part.length;

/** The colours a declaration writes by hand: `#8c3a27`, `rgb(0 0 0 / 0.5)`, `red`. */
export function coloursIn(property: string, value: string): string[] {
  const prop = property.toLowerCase();
  if (prop === 'content') return [];
  const text = without(value);
  const found: { index: number; text: string }[] = [];
  COLOUR_FUNCTION.lastIndex = 0;
  for (let match = COLOUR_FUNCTION.exec(text); match; match = COLOUR_FUNCTION.exec(text)) {
    const end = closing(text, match.index + match[0].length);
    found.push({ index: match.index, text: text.slice(match.index, end) });
    COLOUR_FUNCTION.lastIndex = end;
  }
  HEX.lastIndex = 0;
  for (const match of text.matchAll(HEX))
    if ([3, 4, 6, 8].includes(match[1]!.length)) found.push({ index: match.index, text: match[0] });
  // A word that is a colour's name, where the property takes one; never in a variable of the
  // scene's own, whose words could be anything.
  if (!prop.startsWith('--') && NAMES_COLOUR.test(prop))
    for (const match of text.matchAll(/[a-z]+/gi))
      if (NAMED.has(match[0].toLowerCase())) found.push({ index: match.index, text: match[0] });
  return found.sort((a, b) => a.index - b.index).map((f) => f.text.replace(/\s+/g, ' '));
}

/** Whether a value is one colour: a token's, `--stage-ink: #121a2c`. */
export function isColour(value: string): boolean {
  const text = value.trim();
  const found = coloursIn('color', text);
  return found.length === 1 && found[0] === text.replace(/\s+/g, ' ');
}

/** Whether a font stack names a family by hand: one that isn't a variable or a keyword. */
const stackByHand = (stack: string) =>
  partsOf(stack, (c) => c === ',').some(
    (family) => !isVariable(family) && !KEYWORDS.has(family.toLowerCase()),
  );

/**
 * The font stack a declaration writes by hand, or undefined: a `font-family`'s, and the family of
 * the `font` shorthand without its size, so `font: 40px Arial` is Arial, with a family that isn't
 * a variable or a keyword.
 */
export function familyIn(property: string, value: string): string | undefined {
  const prop = property.toLowerCase();
  if (prop !== 'font-family' && prop !== 'font') return undefined;
  const text = bare(value).trim();
  const family = prop === 'font' ? shorthandFamily(text) : stackByHand(text) ? text : undefined;
  return family?.trim().replace(/\s+/g, ' ');
}

/** A size written in the `font` shorthand as a length or a percentage: `40px`. */
const FONT_LENGTH =
  /^(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|pt|pc|%|ex|ch|vw|vh|vmin|vmax|q|cm|mm|in)$/i;
/** A size written as a keyword, `large`: a word, as a family's may be (`Roboto Medium`). */
const FONT_SIZE_WORD = /^(?:(?:xx?-)?(?:small|large)|xxx-large|medium|smaller|larger)$/i;

/**
 * The family a `font` shorthand names by hand, if it does: what follows its size and line height
 * (`40px/1.2 Arial`). Its size is the part before the slash, or a length, or else the last call
 * before the end, `var(--stage-size-body) Arial`, and only then a size's keyword, which a family's
 * last word may be. With no size, a quoted or a generic family; a system font alone
 * (`font: caption`) is none.
 */
function shorthandFamily(text: string): string | undefined {
  const words = partsOf(text, (c) => /\s/.test(c) || c === '/');
  const slash = words.indexOf('/');
  let size = slash > 0 ? slash - 1 : words.findIndex((word) => FONT_LENGTH.test(word));
  if (size < 0)
    size = words.findLastIndex(
      (word, i) => i < words.length - 1 && /^[a-z-]+\(/i.test(word) && !word.endsWith(','),
    );
  if (size < 0) size = words.findIndex((word) => FONT_SIZE_WORD.test(word));
  if (size < 0) {
    const plain = without(text);
    return /["']/.test(plain) || GENERIC.test(plain) ? text : undefined;
  }
  const family = words.slice(words[size + 1] === '/' ? size + 3 : size + 1).join(' ');
  return family !== '' && stackByHand(family) ? family : undefined;
}

/**
 * Whether a value is a font stack, a token's: `--stage-font-text: Inter, sans-serif`. Each family
 * quoted, named, or a variable, `var(--brand-text, Arial), sans-serif`, and one not a variable.
 */
export function isFamily(value: string): boolean {
  const text = bare(value).trim();
  if (!text || KEYWORDS.has(text.toLowerCase()) || NOT_FAMILY.test(text)) return false;
  const families = partsOf(text, (c) => c === ',');
  return (
    families.every((family) => isVariable(family) || FAMILY.test(family)) &&
    families.some((family) => !isVariable(family))
  );
}

/** One family of a stack: quoted, or its name unquoted, `Hanken Grotesk`, `sans-serif`. */
const FAMILY = /^(?:"[^"]*"|'[^']*'|[a-z_-][\w -]*)$/i;
/** The words a font's other properties take, which no stack is. */
const NOT_FAMILY = /^(?:normal|bold|bolder|lighter|italic|oblique|none|auto)$/i;

/** The properties that space things: margins, paddings, gaps and insets. */
const SPACING =
  /^(?:(?:margin|padding|inset|scroll-margin|scroll-padding)(?:-[a-z-]+)?|(?:row-|column-|grid-|grid-row-|grid-column-)?gap)$/;

/** The lengths a spacing declaration writes by hand, in px or rem, none of them 0. */
export function spacingsIn(property: string, value: string): string[] {
  if (!SPACING.test(property.toLowerCase())) return [];
  return lengthsIn(value);
}

/** The lengths, in px or rem, a value writes by hand, but 0. */
export function lengthsIn(value: string): string[] {
  return [...without(value).matchAll(LENGTH)]
    .filter((m) => Number(m[1]) !== 0)
    .map((m) => `${m[1]}${m[2]!.toLowerCase()}`);
}

/** Whether a value is one length, a token's: `--stage-space-block: 48px`. */
export function isLength(value: string): boolean {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem)$/i.test(value.trim());
}

/** A colour or a font stack as compared: lower case, `#abc` as `#aabbcc`, one kind of quote. */
export function normalValue(value: string): string {
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ').replace(/"/g, "'");
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  return short ? `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}` : text;
}
