/**
 * A theme's version as people see it (ADR 0010, D6). A version is its hash (`rev`) to the CLI, MCP
 * and each deck's record; people see the day it was published, in their own time zone. Where the
 * theme published another version that same day, its time is added, in every place that version is
 * named, so one version always has one name. The year shows when it isn't the current one.
 *
 * Pure, for the page and the CLI alike. Versions are ordered by their timestamps, never by these
 * names.
 */

/** A day as a key to compare, in `timeZone`: "2026-11-28". */
function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The name of the version published at `at`, for a viewer in `timeZone`, among every version of its
 * theme published (`published`, its own among them): "28 November", "28 November, 16:40" where the
 * theme published another that day, "28 November 2025" in another year than `now`'s.
 */
export function versionName(
  at: Date | string,
  published: (Date | string)[],
  timeZone: string,
  now: Date = new Date(),
): string {
  const when = new Date(at);
  const day = dayIn(when, timeZone);
  const sameDay = published
    .map((p) => new Date(p))
    .some((p) => p.getTime() !== when.getTime() && dayIn(p, timeZone) === day);
  const thisYear = dayIn(now, timeZone).slice(0, 4) === day.slice(0, 4);
  const date = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'long',
    ...(thisYear ? {} : { year: 'numeric' }),
  }).format(when);
  if (!sameDay) return date;
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(when);
  return `${date}, ${time}`;
}
