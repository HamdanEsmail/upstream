// Dates as a person would write them.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2013-05-22" becomes "22 May 2013", "2011-05" becomes "May 2011", "1960" stays, null is "no date". */
export function plainDate(date: string | null): string {
  if (date === null) return "no date";
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(date);
  if (!m) return date;
  const year = m[1] ?? date;
  const month = m[2] ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!month) return year;
  return m[3] ? `${Number(m[3])} ${month} ${year}` : `${month} ${year}`;
}
