/**
 * A logbook being brought in, as the data folder holds it until the next start: the copy and its
 * mark of completeness, and the outcome the start reports.
 */

export const INCOMING = "career.db.incoming";
export const INCOMING_MARK = "career.db.incoming.json";

export interface ImportOutcome {
  outcome: "brought-in" | "not-brought-in";
  reason?: string;
  at: string;
}
