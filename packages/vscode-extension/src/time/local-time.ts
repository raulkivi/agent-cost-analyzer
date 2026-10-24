// Calendar-day helpers for the sidebar and the status bar. "Today" is the
// user's local day, so every function takes the IANA time zone to judge it
// in (the models are tested with explicit zones); omitted, it's the
// machine's own, which is what VS Code shows the user.

function partsOf(instant: Date, timeZone: string | undefined): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

// "YYYY-MM-DD" of the instant in the time zone: sorts chronologically as text.
export function dayKeyOf(instant: Date, timeZone?: string): string {
  const { year, month, day } = partsOf(instant, timeZone);
  return `${year}-${month}-${day}`;
}

// The day key before another, by calendar arithmetic (no time zone involved).
export function previousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

// "HH:mm" of the instant on a 24-hour clock in the time zone.
export function timeOfDayOf(instant: Date, timeZone?: string): string {
  const { hour, minute } = partsOf(instant, timeZone);
  return `${hour}:${minute}`;
}
