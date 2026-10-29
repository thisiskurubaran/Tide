// When to ask for an App Store / Play rating: after the app has proven
// useful (some runs, a few days in), at most once per app version, and
// never right after something went wrong.
export interface ReviewState {
  installedAt: number;
  runs: number;
  askedVersion: string | null;
}

export const MIN_RUNS = 5;
export const MIN_DAYS = 3;
const DAY = 24 * 60 * 60 * 1000;

export function shouldAskForReview(s: ReviewState, version: string, now: number): boolean {
  return s.runs >= MIN_RUNS && now - s.installedAt >= MIN_DAYS * DAY && s.askedVersion !== version;
}
