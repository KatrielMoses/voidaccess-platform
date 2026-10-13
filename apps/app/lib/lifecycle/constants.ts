/** Lifecycle email timing (PRD §5). Copy lives in packages/emails/src/content.ts. */
export const NUDGE_AFTER_HOURS = 24;
/** Don't nudge or welcome accounts older than this: a late first deploy must not mail the whole back catalogue. */
export const NUDGE_MAX_AGE_DAYS = 7;
export const WELCOME_BACKSTOP_HOURS = 48;
/** "What next" goes out this long after the first completed run, so it never lands beside the results-ready email. */
export const WHAT_NEXT_DELAY_MINUTES = 30;
export const WHAT_NEXT_MAX_AGE_DAYS = 7;
/** Rows handled per kind per cron call (the cron runs hourly and picks up the rest next time). */
export const BATCH = 200;
