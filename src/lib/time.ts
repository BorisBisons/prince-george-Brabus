const VANCOUVER_TZ = "America/Vancouver";

/** Local wall-clock parts in Prince George. */
export function vancouverParts(date: Date): { y: number; m: number; d: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VANCOUVER_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hour: get("hour") % 24, minute: get("minute") };
}

/** Quiet hours (spec §7): 9 PM–8 AM local, per-user adjustable. */
export function isQuietHoursInVancouver(date: Date, startHour = 21, endHour = 8): boolean {
  const { hour } = vancouverParts(date);
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

/** The UTC instant when the Vancouver wall clock reads y-m-d hh:mm (DST-correct). */
export function zonedTimeInVancouver(y: number, m: number, d: number, hh: number, mm: number): Date {
  let utc = Date.UTC(y, m - 1, d, hh, mm);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: VANCOUVER_TZ,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(new Date(utc));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const rendered = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
    const target = Date.UTC(y, m - 1, d, hh, mm);
    const diff = target - rendered;
    if (diff === 0) break;
    utc += diff;
  }
  return new Date(utc);
}

/** 11:59 PM today in Prince George (America/Vancouver), DST-correct. */
export function endOfDayInVancouver(now: Date): Date {
  const { y, m, d } = vancouverParts(now);
  return zonedTimeInVancouver(y, m, d, 23, 59);
}

/** UTC range [start, end) covering one Vancouver calendar day. */
export function vancouverDayRange(date: Date): { start: Date; end: Date } {
  const { y, m, d } = vancouverParts(date);
  return { start: zonedTimeInVancouver(y, m, d, 0, 0), end: zonedTimeInVancouver(y, m, d + 1, 0, 0) };
}
