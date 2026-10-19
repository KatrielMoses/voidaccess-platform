/** Admin console tunables. Prices and credit values come from @voidaccess/config, never from here. */

/** A user with at least this many blocked_query runs inside ABUSE_WINDOW_DAYS appears in the abuse queue. */
export const ABUSE_BLOCKED_THRESHOLD = 3;
export const ABUSE_WINDOW_DAYS = 30;

/** Every state-changing admin action needs a typed reason at least this long (and at most REASON_MAX). */
export const REASON_MIN = 8;
export const REASON_MAX = 1000;

/** Largest single manual credit grant (a typo guard, not a policy: grant twice for more). */
export const MAX_ADMIN_GRANT = 50_000;

export const USERS_PAGE_SIZE = 50;
export const INVESTIGATIONS_ON_USER_DETAIL = 50;
export const AUDIT_ON_USER_DETAIL = 50;
export const COST_WORST_RUNS = 10;
export const COST_DEFAULT_DAYS = 30;
export const COST_MAX_DAYS = 365;
export const OVERVIEW_RUN_DAYS = 14;
export const OVERVIEW_COHORT_WEEKS = 8;

/** The #1 metric (PRD §7): % of verified signups completing a first investigation inside this window. */
export const FIRST_INVESTIGATION_WINDOW_HOURS = 24;

export const CREEM_DASHBOARD_URL = "https://creem.io/dashboard";
