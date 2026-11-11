// One headline verdict for a trail, and which end of the trail it rests on.
import type { Change } from "./changes";
import type { ResearchVerdict } from "./report";
import type { StepReading } from "./trail";

export type Verdict = "said_by_someone_else" | "no_original_source" | "changed_on_the_way" | "out_of_date" | "matches_original" | "not_settled";

/** `original`: a study, report, dataset or other first-hand source. `earliest_copy`: only the oldest repeat found. */
export type Reached = "original" | "earliest_copy" | "nothing";

export type VerdictInput = {
  /** One reading per step, the highlighted page first. */
  readings: StepReading[];
  /** What the research run concluded; null when no run finished. */
  research: { verdict: ResearchVerdict | null; originFound: boolean } | null;
  /** The changes code could name along the confirmed steps. */
  changes: Change[];
  /** The year of the earliest step, when it has a date. */
  originYear: number | null;
  thisYear: number;
};

/** An original this old, quoted with its year dropped, is out of date. */
const OLD_AFTER_YEARS = 5;

/**
 * Precedence: said by someone else, no original source, changed on the way, out of date,
 * matches the original. Not settled when the steps that matter could not be confirmed.
 */
export function decide(input: VerdictInput): { verdict: Verdict; reached: Reached } {
  const beyondStart = input.readings.slice(1);
  if (!beyondStart.some((r) => r === "exact" || r === "close" || r === "offline")) return { verdict: "not_settled", reached: "nothing" };

  const said = input.research?.verdict ?? null;
  if (input.research === null || said === null) return { verdict: "not_settled", reached: "earliest_copy" };
  const reached: Reached = input.research.originFound ? "original" : "earliest_copy";

  if (said === "said_by_someone_else") return { verdict: "said_by_someone_else", reached };
  if (said === "no_original_source") return { verdict: "no_original_source", reached: "earliest_copy" };

  const figureOrCare = input.changes.some((c) => c.kind === "rounded" || c.kind === "number_changed" || c.kind === "careful_word_dropped");
  if (figureOrCare || said === "changed_on_the_way") return { verdict: "changed_on_the_way", reached };

  const old = input.originYear !== null && input.thisYear - input.originYear >= OLD_AFTER_YEARS;
  if (said === "outdated" || (old && input.changes.some((c) => c.kind === "year_dropped"))) return { verdict: "out_of_date", reached };

  return { verdict: "matches_original", reached };
}
