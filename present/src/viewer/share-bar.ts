/**
 * A share link's own controls, over the stage's corner: the PDF to download, and the animations on
 * or off. They show while the pointer moves or the stage is tapped, and fade a moment after; they
 * are buttons, so a click on them never steps the deck (taps.ts). A link only views the deck, so
 * it has no fullscreen.
 */
export function shareBar(
  root: HTMLElement,
  shared: { pdf?: string },
  setAnimate: (on: boolean) => void,
): () => void {
  const bar = document.createElement('div');
  bar.className = 'tobos-share-bar';
  if (shared.pdf) {
    const pdf = button('Download PDF', (b) => void download(b, shared.pdf!));
    pdf.prepend(icon(DOWNLOAD));
    bar.append(pdf);
  }
  bar.append(animationToggle(setAnimate));
  root.append(bar);

  let timer = 0;
  const show = () => {
    bar.classList.add('tobos-shown');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => bar.classList.remove('tobos-shown'), 2500);
  };
  show();
  root.addEventListener('pointermove', show);
  root.addEventListener('pointerdown', show);
  return () => {
    window.clearTimeout(timer);
    root.removeEventListener('pointermove', show);
    root.removeEventListener('pointerdown', show);
    bar.remove();
  };
}

function button(label: string, onClick: (button: HTMLButtonElement) => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.append(text(label));
  element.addEventListener('click', () => {
    // The arrow keys and space step the deck again, rather than press this.
    element.blur();
    onClick(element);
  });
  return element;
}

function text(label: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.textContent = label;
  return span;
}

/**
 * Animations on or off, as the deck's page has it: as the visitor's system asks (no animation for
 * less motion) until they choose, and then as they chose, which this browser remembers.
 */
function animationToggle(setAnimate: (on: boolean) => void): HTMLButtonElement {
  let on = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    const stored = localStorage.getItem('tobos:animate');
    if (stored !== null) on = stored !== 'false';
  } catch {
    // Storage blocked: as the system asks.
  }
  const element = button('Animations', () => {
    on = !on;
    try {
      localStorage.setItem('tobos:animate', String(on));
    } catch {
      // Private browsing may refuse: the choice lasts until the page closes.
    }
    update();
  });
  element.classList.add('tobos-animations');
  // The label stays; the icon says on or off, struck through when off.
  const update = () => {
    element.querySelector('svg')?.remove();
    element.prepend(icon(on ? SPARKLES : SPARKLES_OFF));
    element.setAttribute('aria-pressed', String(on));
    element.title = `Turn the animations ${on ? 'off' : 'on'}`;
    setAnimate(on);
  };
  update();
  return element;
}

// Lucide's icons (ISC), drawn as the app draws them; the off one is struck through.
const DOWNLOAD =
  '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>';
const SPARKLES =
  '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>';
const SPARKLES_OFF = `${SPARKLES}<path d="m2 2 20 20"/>`;

function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

/**
 * The PDF is made on its first download, which can take a while for a long deck: the button says
 * so meanwhile, and the file saves once it has arrived.
 */
async function download(button: HTMLButtonElement, url: string) {
  if (button.disabled) return;
  // The label is the button's text; its icon stays.
  const words = button.querySelector('span')!;
  const label = words.textContent;
  // The bar stays in sight while it has something to say: preparing, or what went wrong.
  const bar = button.closest('.tobos-share-bar');
  bar?.classList.add('tobos-busy');
  const done = () => {
    words.textContent = label;
    bar?.classList.remove('tobos-busy');
  };
  button.disabled = true;
  words.textContent = 'Preparing the PDF…';
  try {
    const response = await fetch(url);
    // The server's own words when it wrote a short one for people; a page or a long body isn't.
    if (!response.ok) {
      const said = response.headers.get('content-type')?.startsWith('text/plain')
        ? (await response.text()).trim()
        : '';
      throw new Error(said.length > 0 && said.length <= 160 ? said : '');
    }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName(response.headers.get('content-disposition')) ?? 'deck.pdf';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
    done();
  } catch (error) {
    words.textContent = (error as Error).message || 'The PDF could not be made.';
    window.setTimeout(done, 6000);
  } finally {
    button.disabled = false;
  }
}

/** The name a Content-Disposition header gives the file: its UTF-8 one if it has one. */
export function fileName(header: string | null): string | undefined {
  if (!header) return undefined;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  if (utf8) {
    try {
      return decodeURIComponent(utf8);
    } catch {
      // fall through to the plain one
    }
  }
  return /filename="([^"]+)"/i.exec(header)?.[1];
}
