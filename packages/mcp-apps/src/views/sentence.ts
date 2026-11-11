// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// A server reason may already end in a full stop; the view adds its own, so
// strip the server's first (the real server's "... from 2026-12-01." showed ".." in G5).
export const withoutStop = (reason: string): string => reason.trim().replace(/[.!?]+$/, "");
