/**
 * A server-sent events stream that outlasts the server going away. EventSource reconnects by
 * itself only when a connection drops; when a reconnect is answered with an error, as the proxy
 * answers 502 while the app restarts for a release, it gives up for good. This one opens it
 * again, waiting longer each time, up to a minute.
 *
 * `onOpen` runs on every connection, `again` on all but the first: what was sent while the
 * stream was away is missed, so that is the moment to read the state afresh.
 */
export function stream(
  url: string,
  listeners: Record<string, (data: string) => void>,
  onOpen?: (again: boolean) => void,
): () => void {
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wait = 1000;
  let opened = false;
  let stopped = false;
  const open = () => {
    const current = (source = new EventSource(url));
    for (const [type, listener] of Object.entries(listeners))
      current.addEventListener(type, (event) => listener((event as MessageEvent<string>).data));
    current.addEventListener('open', () => {
      wait = 1000;
      onOpen?.(opened);
      opened = true;
    });
    current.addEventListener('error', () => {
      if (stopped || current.readyState !== EventSource.CLOSED) return;
      timer = setTimeout(open, wait);
      wait = Math.min(wait * 2, 60_000);
    });
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    source?.close();
  };
}
