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
 * window opens beside this one, to be dragged across. Null if the browser blocked it.
 *
 * The first time, Chrome asks the person before it says. A click may open a window for five
 * seconds, so the answer gets three: later, the window opens beside this one all the same.
 */
export async function openAudience(url: string): Promise<Window | null> {
  const name = 'tobos-audience';
  const beside = 'width=1280,height=720';
  const getScreenDetails = (
    window as unknown as { getScreenDetails?: () => Promise<ScreenDetails> }
  ).getScreenDetails;
  if (!getScreenDetails) return window.open(url, name, beside);
  const details = await Promise.race([
    // Permission denied: beside this one.
    getScreenDetails.call(window).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, 3000)),
  ]);
  const other = details?.screens.find((s) => s !== details.currentScreen);
  if (!other) return window.open(url, name, beside);
  const features = `left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
  return window.open(url, name, features);
}
