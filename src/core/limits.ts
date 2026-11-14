// Every number that bounds what Upstream does, in one place.

/** A highlight shorter than this is not a claim; longer than this is more than a sentence or two. */
export const TEXT_MIN = 12;
export const TEXT_MAX = 600;

/** New traces one visitor may start in an hour, and all visitors together in a day. */
export const TRACES_PER_VISITOR_PER_HOUR = 6;
export const TRACES_PER_DAY = 40;

/**
 * Pages Upstream may read in a day. TinyFish Fetch is free up to 1,000 pages a day on the
 * account, and my other projects read with the same account, so Upstream keeps to half.
 */
export const READS_PER_DAY = 500;
/** A new trace is started only while at least this much of the reading budget is left. */
export const READS_A_TRACE_NEEDS = 40;

/** Links from the highlighted paragraph that are kept. */
export const NEAR_MAX = 20;

/** How many links deep the link follower goes, and how many linked pages it reads per try. */
export const FOLLOW_DEPTH = 5;
export const FOLLOW_PAGES_PER_TRY = 5;
/** The link follower reads only the start of each linked page; a source states its claim early. */
export const FOLLOW_CHARS = 40_000;

/**
 * When the links run out, TinyFish Search is asked once for the sentence. Of the pages it
 * lists, at most this many are read, this many to a try (one Fetch call each), and at most
 * this many that hold the sentence and are older than the trail are kept.
 */
export const SEARCH_READ_MAX = 10;
export const SEARCH_PAGES_PER_TRY = 5;
export const SEARCH_KEEP = 3;
/** Pages from Search that give no date of their own and are looked up at the Internet Archive, per try. */
export const SEARCH_ARCHIVE_LOOKUPS = 2;
/** How many links deep the link follower goes on from the oldest page Search found. */
export const FOLLOW_ON_DEPTH = 2;

/**
 * TinyFish gave two completed research runs a day free on each account until 11 November 2026.
 * A run is still started as a free one until the wallet has shown a charge, which it did on
 * 12 November: see src/trace/deep.ts.
 */
export const FREE_RESEARCH_RUNS_PER_DAY = 2;
/** What TinyFish charges for a research run. */
export const RESEARCH_RUN_USD = 2;
/**
 * A free run is booked this long after its trail is done, to leave a charge time to reach the
 * wallet: a TinyFish charge has been seen to land some minutes after its run ended. No visitor
 * waits for it.
 */
export const BOOK_AFTER_MS = 600_000;

/**
 * Cloudflare's free plan allows one Workflow run 50 requests to other hosts. A trace is
 * therefore carried by several runs, one after another ("legs"), each kept well under that:
 * the first reads the page, follows links, searches for the sentence, follows links on from
 * what the search found and starts the deep search (27 requests at most),
 * a waiting leg reads the search this many times, and a checking leg checks this many
 * proposed steps (5 requests each at most).
 */
export const POLLS_PER_LEG = 40;
export const CHECKS_PER_LEG = 8;

/** The deep search is checked this often, at most this many times (30 minutes). */
export const POLL_MS = 15_000;
export const POLL_TURNS = 120;

/** Steps of a proposed trail that are checked. */
export const PROPOSED_MAX = 12;
