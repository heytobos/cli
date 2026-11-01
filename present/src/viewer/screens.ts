interface ScreenDetailed {
  left: number;
  top: number;
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  isPrimary: boolean;
}

interface ScreenDetails {
  screens: ScreenDetailed[];
  currentScreen: ScreenDetailed;
}

/**
 * Open the audience window, on another screen if there is one. The Window Management API
 * (Chrome, secure context, allowed once) tells us where the screens are; without it the
 * window opens beside this one, to be dragged across.
 */
export async function openAudience(url: string): Promise<Window | null> {
  const name = 'tobos-audience';
  const getScreenDetails = (
    window as unknown as { getScreenDetails?: () => Promise<ScreenDetails> }
  ).getScreenDetails;
  if (getScreenDetails) {
    try {
      const details = await getScreenDetails.call(window);
      const other = details.screens.find((s) => s !== details.currentScreen);
      if (other) {
        const features = `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
        return window.open(url, name, features);
      }
    } catch {
      // Permission denied: fall through to a plain window.
    }
  }
  return window.open(url, name, 'width=1280,height=720');
}
