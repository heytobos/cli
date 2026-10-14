/** What the server tells about a deck's activities: phones what is open, the projector the results. */

/** An activity as a phone needs it: no more. */
export type PhoneActivity =
  | { id: string; kind: 'choice'; prompt: string; options: string[] }
  | {
      id: string;
      kind: 'text';
      prompt?: string;
      fields: { id: string; label: string; multiline?: boolean; max: number }[];
    };

/** Nothing live, or the show and its open activity, if any. */
export type PhoneState =
  { live: false } | { live: true; show: string; activity: PhoneActivity | null };

/** What the projector hears: the show, and every activity answered in it. */
export interface Results {
  show: string | null;
  joined: number;
  activities: Record<string, { answered: number; counts?: number[] }>;
}
