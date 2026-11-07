// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { ApiRequestError, apiErrorDetail } from "./api-request-error.js";

describe("ApiRequestError", () => {
  it("keeps the status wording, with the backend's message after it", () => {
    expect(new ApiRequestError("/api/x", 404, "Unknown session").message).toBe("Request to /api/x failed with status 404: Unknown session");
    expect(new ApiRequestError("getSession", 500, undefined).message).toBe("Request to getSession failed with status 500");
  });

  it("apiErrorDetail gives the backend's words when there are some, else the message", () => {
    expect(apiErrorDetail(new ApiRequestError("/api/x", 400, "model must be a vendor profile's model id"))).toBe("model must be a vendor profile's model id");
    expect(apiErrorDetail(new ApiRequestError("/api/x", 500, undefined))).toBe("Request to /api/x failed with status 500");
    expect(apiErrorDetail(new Error("network error"))).toBe("network error");
    expect(apiErrorDetail("odd")).toBe("odd");
  });
});
