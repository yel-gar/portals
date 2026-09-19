/**
 * Formatting helpers. All backend timestamps are ISO 8601 UTC; they are shown in
 * the visitor's local timezone, while relative strings are computed against an
 * injectable `now` so tests stay deterministic.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parse(iso: string): number {
  return new Date(iso).getTime();
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Human-friendly "how long ago", e.g. «5 мин назад», «3 ч назад», «2 дн назад». */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const diff = now - parse(iso);
  if (diff < MINUTE) {
    return "только что";
  }
  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE);
    return `${m} ${plural(m, "минуту", "минуты", "минут")} назад`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return `${h} ${plural(h, "час", "часа", "часов")} назад`;
  }
  const d = Math.floor(diff / DAY);
  return `${d} ${plural(d, "день", "дня", "дней")} назад`;
}

/** Countdown to an expiry instant, e.g. «через 2 ч 5 мин» or «истёк». */
export function formatTimeLeft(iso: string, now: number = Date.now()): string {
  const diff = parse(iso) - now;
  if (diff <= 0) {
    return "истёк";
  }
  if (diff < MINUTE) {
    return "меньше минуты";
  }
  if (diff < HOUR) {
    const m = Math.round(diff / MINUTE);
    return `через ${m} ${plural(m, "минуту", "минуты", "минут")}`;
  }
  const h = Math.floor(diff / HOUR);
  const m = Math.round((diff % HOUR) / MINUTE);
  if (h < DAY) {
    return m ? `через ${h} ч ${m} мин` : `через ${h} ч`;
  }
  const d = Math.floor(diff / DAY);
  return `через ${d} ${plural(d, "день", "дня", "дней")}`;
}

/** Absolute local date and time, e.g. «19.09.2026, 15:04:05». */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

/** Round a 0..1 share to a whole percentage. */
export function toPercent(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Math.round((value / total) * 100);
}
