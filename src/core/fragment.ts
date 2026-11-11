// "Open at the sentence": an address that makes the browser scroll to a sentence and
// highlight it (a text fragment). Browsers do not do this inside PDFs.

const AROUND = /^[\s"'“”‘’.…]+|[\s"'“”‘’.…,;:!?)]+$/g;

/** Dashes, commas and ampersands have a meaning in a text fragment, so they are escaped. */
const term = (words: string[]): string => encodeURIComponent(words.join(" ")).replace(/-/g, "%2D");

export function sentenceLink(url: string, sentence: string): string {
  if (/\.pdf(?:$|[?#])/i.test(url)) return url;
  const clean = sentence.replace(AROUND, "").replace(/\s+/g, " ");
  if (clean === "") return url;
  const words = clean.split(" ");
  // A long sentence is named by its first and last words; the browser highlights all between.
  const text = words.length <= 8 ? term(words) : `${term(words.slice(0, 4))},${term(words.slice(-4))}`;
  return `${url.replace(/#.*$/, "")}#:~:text=${text}`;
}
