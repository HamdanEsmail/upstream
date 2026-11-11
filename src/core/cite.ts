// "Cite it right": a citation that points at where the claim came from, not at the copy.
import { plainDate } from "./dates";
import type { Reached, Verdict } from "./verdict";

export type CiteInput = {
  verdict: Verdict;
  reached: Reached;
  /** The last step of the trail; null when there is none to point at. */
  origin: { publisher: string; title: string | null; date: string | null; url: string | null; wording: string | null } | null;
  trailUrl: string;
};

export function citation(input: CiteInput): { plain: string; markdown: string } {
  const { origin, trailUrl } = input;
  const trail = { plain: `\nTrail: ${trailUrl}`, markdown: ` [Trail](${trailUrl})` };
  if (origin === null || input.verdict === "not_settled") {
    const line = "The source of this claim could not be settled.";
    return { plain: line + trail.plain, markdown: line + trail.markdown };
  }

  const when = plainDate(origin.date);
  if (input.verdict === "no_original_source") {
    const lead = "No original source is known for this claim. The trail ends at ";
    return {
      plain: lead + (origin.url ? `${origin.publisher} (${when}): ${origin.url}` : `${origin.publisher} (${when}), which is not readable online.`) + trail.plain,
      markdown: lead + (origin.url ? `[${origin.publisher}](${origin.url}) (${when}).` : `${origin.publisher} (${when}), which is not readable online.`) + trail.markdown,
    };
  }

  const first = input.reached === "original";
  const name = origin.title ? `${origin.publisher}, "${origin.title}"` : origin.publisher;
  const lead = first ? "" : "Earliest known appearance: ";
  const quoted = origin.wording ? `${first ? "Original wording" : "Wording there"}: "${origin.wording}"` : "";
  return {
    plain: lead + (origin.url ? `${name} (${when}). ${origin.url}` : `${name} (${when}). Not readable online.`) + (quoted ? "\n" + quoted : "") + trail.plain,
    markdown: lead + (origin.url ? `[${name}](${origin.url}) (${when}).` : `${name} (${when}). Not readable online.`) + (quoted ? " " + quoted : "") + trail.markdown,
  };
}
