/**
 * A share link's own controls, over the stage's corner: the PDF to download, and fullscreen. They
 * show while the pointer moves or the stage is tapped, and fade a moment after; they are buttons,
 * so a click on them never steps the deck (taps.ts).
 */
export function shareBar(
  root: HTMLElement,
  shared: { pdf?: string },
  toggleFullscreen: () => void,
): () => void {
  const bar = document.createElement('div');
  bar.className = 'tobos-share-bar';
  if (shared.pdf) bar.append(button('Download PDF', (b) => void download(b, shared.pdf!)));
  if (document.fullscreenEnabled) bar.append(button('Fullscreen', () => toggleFullscreen()));
  if (!bar.childElementCount) return () => {};
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
  element.textContent = label;
  element.addEventListener('click', () => {
    // The arrow keys and space step the deck again, rather than press this.
    element.blur();
    onClick(element);
  });
  return element;
}

/**
 * The PDF is made on its first download, which can take a while for a long deck: the button says
 * so meanwhile, and the file saves once it has arrived.
 */
async function download(button: HTMLButtonElement, url: string) {
  if (button.disabled) return;
  const label = button.textContent;
  // The bar stays in sight while it has something to say: preparing, or what went wrong.
  const bar = button.closest('.tobos-share-bar');
  bar?.classList.add('tobos-busy');
  const done = () => {
    button.textContent = label;
    bar?.classList.remove('tobos-busy');
  };
  button.disabled = true;
  button.textContent = 'Preparing the PDF…';
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
    button.textContent = (error as Error).message || 'The PDF could not be made.';
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
