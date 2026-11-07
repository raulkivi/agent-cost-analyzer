// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./format-relative-time.js";

const now = new Date("2026-08-08T12:00:00.000Z");

describe("formatRelativeTime", () => {
  it("returns 'just now' for timestamps under a minute old", () => {
    expect(formatRelativeTime("2026-08-08T11:59:30.000Z", now)).toBe("just now");
  });

  it("formats minutes ago", () => {
    expect(formatRelativeTime("2026-08-08T11:55:00.000Z", now)).toBe("5 minutes ago");
    expect(formatRelativeTime("2026-08-08T11:59:00.000Z", now)).toBe("1 minute ago");
  });

  it("formats hours ago", () => {
    expect(formatRelativeTime("2026-08-08T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-08-08T11:00:00.000Z", now)).toBe("1 hour ago");
  });

  it("formats days ago", () => {
    expect(formatRelativeTime("2026-08-06T12:00:00.000Z", now)).toBe("2 days ago");
    expect(formatRelativeTime("2026-08-07T12:00:00.000Z", now)).toBe("1 day ago");
  });

  it("formats months ago", () => {
    expect(formatRelativeTime("2026-06-08T12:00:00.000Z", now)).toBe("2 months ago");
  });

  it("formats years ago", () => {
    expect(formatRelativeTime("2024-08-08T12:00:00.000Z", now)).toBe("2 years ago");
  });
});
