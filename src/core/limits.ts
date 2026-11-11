// Every number that bounds what Upstream does, in one place.

/** A highlight shorter than this is not a claim; longer than this is more than a sentence or two. */
export const TEXT_MIN = 12;
export const TEXT_MAX = 600;

/** New traces one visitor may start in an hour, and all visitors together in a day. */
export const TRACES_PER_VISITOR_PER_HOUR = 6;
export const TRACES_PER_DAY = 60;

/** Links from the highlighted paragraph that are kept. */
export const NEAR_MAX = 20;

/** How many links deep the link follower goes, and how many linked pages it reads per try. */
export const FOLLOW_DEPTH = 5;
export const FOLLOW_PAGES_PER_TRY = 5;
/** The link follower reads only the start of each linked page; a source states its claim early. */
export const FOLLOW_CHARS = 40_000;

/** TinyFish gives two completed research runs a day free on each account. */
export const FREE_RESEARCH_RUNS_PER_DAY = 2;
/** What a research run costs after the free ones. */
export const RESEARCH_RUN_USD = 2;

/** The deep search is checked this often, at most this many times (30 minutes). */
export const POLL_MS = 15_000;
export const POLL_TURNS = 120;

/** Steps of a proposed trail that are checked. */
export const PROPOSED_MAX = 12;
