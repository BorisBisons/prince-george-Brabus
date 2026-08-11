/** 11:59 PM today in Prince George (America/Vancouver), DST-correct. */
export function endOfDayInVancouver(now: Date): Date {
  const tz = "America/Vancouver";
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = fmt.format(now).split("-").map(Number) as [number, number, number];

  // Find the UTC instant that renders as 23:59 local, correcting for offset.
  let utc = Date.UTC(y, m - 1, d, 23, 59);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(utc));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const rendered = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const target = Date.UTC(y, m - 1, d, 23, 59);
    const diff = target - rendered;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}
