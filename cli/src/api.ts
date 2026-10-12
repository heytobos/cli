import { settings } from './config.ts';
import { CliError, EXIT, offerUpdate } from './out.ts';

declare const TOBOS_VERSION: string;
export const VERSION = typeof TOBOS_VERSION === 'string' ? TOBOS_VERSION : 'dev';

/** Is version a newer than b? Plain x.y.z; anything else (a checkout's "dev") never is. */
export function newer(a: string, b: string): boolean {
  const parse = (v: string) =>
    /^\d+\.\d+\.\d+/.test(v) ? v.split('.').map((n) => parseInt(n)) : null;
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  /** Send no token (for login). */
  anonymous?: boolean;
  server?: string;
  /** For a raw body. */
  contentType?: string;
}

export async function api<T = Record<string, unknown>>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const response = await request(path, options);
  const text = await response.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text.slice(0, 500) };
  }
  if (!response.ok) throw failure(response, data);
  return data as T;
}

/** A failed response as an error, with what the server says besides (a limit's plan) for --json. */
export function failure(response: Response, data: unknown, prefix = ''): CliError {
  const { error, message, ...extra } = data as { error?: string; message?: string };
  return new CliError(
    prefix + (error ?? message ?? `${response.status} ${response.statusText}`),
    response.status === 401 ? EXIT.auth : EXIT.error,
    { ...extra, status: response.status },
  );
}

export async function request(path: string, options: ApiOptions = {}): Promise<Response> {
  const { server, token } = settings();
  const headers: Record<string, string> = {
    'user-agent': `tobos/${VERSION}`,
    accept: 'application/json',
  };
  // Not a browser: say which server we mean, so SvelteKit's cross-site check has an origin.
  headers.origin = options.server ?? server;
  if (!options.anonymous) {
    if (!token)
      throw new CliError(
        'Not logged in. Ask the person you work for for their e-mail address, then run `tobos login <email>`.',
        EXIT.auth,
      );
    headers.authorization = `Bearer ${token}`;
  }
  let body: BodyInit | undefined;
  if (options.body instanceof Uint8Array || options.body instanceof ReadableStream) {
    body = options.body as BodyInit;
    if (options.contentType) headers['content-type'] = options.contentType;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const url = `${options.server ?? server}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      duplex: 'half',
    } as RequestInit);
  } catch (error) {
    throw new CliError(
      `Can't reach ${options.server ?? server}: ${(error as Error).cause ?? (error as Error).message}`,
    );
  }
  // The server names the latest CLI on every response: the one place people learn of a new
  // one, and with it of a newer skill, which the new CLI writes over the old.
  const latest = response.headers.get('tobos-latest-cli');
  if (latest && newer(latest, VERSION))
    offerUpdate(`tobos ${latest} is out (you have ${VERSION}): npm i -g @tobos/cli`);
  return response;
}
