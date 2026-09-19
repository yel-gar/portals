import { describe, expect, it } from "vitest";

import { formatDateTime, formatRelative, formatTimeLeft, toPercent } from "./format";

const NOW = Date.parse("2026-09-19T12:00:00Z");

describe("formatRelative", () => {
  it("returns «только что» for freshness under a minute", () => {
    expect(formatRelative("2026-09-19T11:59:30Z", NOW)).toBe("только что");
  });

  it("pluralizes minutes correctly", () => {
    expect(formatRelative("2026-09-19T11:58:00Z", NOW)).toBe("2 минуты назад");
    expect(formatRelative("2026-09-19T11:55:00Z", NOW)).toBe("5 минут назад");
    expect(formatRelative("2026-09-19T11:59:00Z", NOW)).toBe("1 минуту назад");
  });

  it("pluralizes hours and days", () => {
    expect(formatRelative("2026-09-19T09:00:00Z", NOW)).toBe("3 часа назад");
    expect(formatRelative("2026-09-18T12:00:00Z", NOW)).toBe("1 день назад");
    expect(formatRelative("2026-09-16T12:00:00Z", NOW)).toBe("3 дня назад");
  });
});

describe("formatTimeLeft", () => {
  it("reports expiry in the past", () => {
    expect(formatTimeLeft("2026-09-19T11:50:00Z", NOW)).toBe("истёк");
  });

  it("shows hour and minute parts", () => {
    expect(formatTimeLeft("2026-09-19T14:05:00Z", NOW)).toBe("через 2 ч 5 мин");
    expect(formatTimeLeft("2026-09-19T14:00:00Z", NOW)).toBe("через 2 ч");
  });

  it("pluralizes minutes under an hour", () => {
    expect(formatTimeLeft("2026-09-19T12:30:00Z", NOW)).toBe("через 30 минут");
    expect(formatTimeLeft("2026-09-19T12:01:00Z", NOW)).toBe("через 1 минуту");
  });

  it("falls back to days for long horizons", () => {
    expect(formatTimeLeft("2026-09-22T12:00:00Z", NOW)).toBe("через 3 дня");
  });
});

describe("formatDateTime", () => {
  it("renders a ru-RU date-time", () => {
    const formatted = formatDateTime("2026-09-19T15:04:05Z");
    expect(formatted).toMatch(/\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}/);
  });

  it("renders a placeholder for invalid input", () => {
    expect(formatDateTime("not-a-date")).toBe("—");
  });
});

describe("toPercent", () => {
  it("rounds shares against a total", () => {
    expect(toPercent(1, 3)).toBe(33);
    expect(toPercent(3, 3)).toBe(100);
    expect(toPercent(0, 5)).toBe(0);
  });

  it("returns 0 for an empty total", () => {
    expect(toPercent(4, 0)).toBe(0);
  });
});
