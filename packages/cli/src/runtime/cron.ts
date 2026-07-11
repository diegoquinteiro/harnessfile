// Hand-rolled 5-field cron matcher (minute hour day-of-month month day-of-week).
// Supports: * , - / and numeric values. Day-of-week accepts 0-7 (both 0 and 7 = Sunday).
// Timezone-aware via Intl — no dependencies.

export interface CronParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const FIELD_RANGES: Array<[keyof CronParts, number, number]> = [
  ["minute", 0, 59],
  ["hour", 0, 23],
  ["dayOfMonth", 1, 31],
  ["month", 1, 12],
  ["dayOfWeek", 0, 7], // 0 and 7 both mean Sunday
];

export function parseCronExpression(expr: string): string[] {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression '${expr}': expected 5 fields (minute hour day-of-month month day-of-week), got ${fields.length}`,
    );
  }
  // Validate each field parses against its range
  for (let i = 0; i < 5; i++) {
    const [, min, max] = FIELD_RANGES[i];
    fieldMatches(fields[i], min, min, max); // throws on malformed field
  }
  return fields;
}

export function cronMatches(
  expr: string,
  date: Date,
  timezone?: string,
): boolean {
  const fields = parseCronExpression(expr);
  const parts = getDateParts(date, timezone);

  return (
    fieldMatches(fields[0], parts.minute, 0, 59) &&
    fieldMatches(fields[1], parts.hour, 0, 23) &&
    fieldMatches(fields[2], parts.dayOfMonth, 1, 31) &&
    fieldMatches(fields[3], parts.month, 1, 12) &&
    dowMatches(fields[4], parts.dayOfWeek)
  );
}

/** A stable key identifying the minute a date falls in (per timezone) — used to fire once per minute. */
export function minuteKey(date: Date, timezone?: string): string {
  const p = getDateParts(date, timezone);
  return `${p.year}-${p.month}-${p.dayOfMonth}T${p.hour}:${p.minute}`;
}

function dowMatches(field: string, value: number): boolean {
  // Normalize 7 → 0 in the expression so both Sunday forms work.
  const normalized = field.replace(/(?<![0-9])7(?![0-9])/g, "0");
  return fieldMatches(normalized, value, 0, 6);
}

function fieldMatches(
  field: string,
  value: number,
  min: number,
  max: number,
): boolean {
  for (const part of field.split(",")) {
    let range = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      range = part.slice(0, slash);
      step = parseIntStrict(part.slice(slash + 1), part);
      if (step < 1) throw new Error(`Invalid cron step in '${part}'`);
    }

    let lo: number;
    let hi: number;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      lo = parseIntStrict(a, part);
      hi = parseIntStrict(b, part);
    } else {
      lo = parseIntStrict(range, part);
      hi = slash !== -1 ? max : lo;
    }

    if (lo < min || hi > max || lo > hi) {
      throw new Error(
        `Invalid cron field '${part}': value out of range ${min}-${max}`,
      );
    }

    if (value >= lo && value <= hi && (value - lo) % step === 0) {
      return true;
    }
  }
  return false;
}

function parseIntStrict(raw: string, context: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid cron field '${context}'`);
  }
  return parseInt(raw, 10);
}

interface DateParts extends CronParts {
  year: number;
}

function getDateParts(date: Date, timezone?: string): DateParts {
  if (!timezone) {
    return {
      year: date.getFullYear(),
      minute: date.getMinutes(),
      hour: date.getHours(),
      dayOfMonth: date.getDate(),
      month: date.getMonth() + 1,
      dayOfWeek: date.getDay(),
    };
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(date)) {
    parts[p.type] = p.value;
  }
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: parseInt(parts["year"], 10),
    minute: parseInt(parts["minute"], 10),
    // Intl may render midnight as "24" with hour12: false — normalize to 0.
    hour: parseInt(parts["hour"], 10) % 24,
    dayOfMonth: parseInt(parts["day"], 10),
    month: parseInt(parts["month"], 10),
    dayOfWeek: weekdays.indexOf(parts["weekday"]),
  };
}
