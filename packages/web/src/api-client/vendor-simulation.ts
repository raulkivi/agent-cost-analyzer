// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  sessionSchema,
  vendorComparisonSchema,
  vendorProfileSummarySchema,
  type Session,
  type VendorComparison,
  type VendorProfileSummary,
} from "@agent-cost-analyzer/domain";
import { z } from "zod";
import { getApiTransport } from "./current-transport.js";

// Step 13.6: Learn scenarios replayed on a vendor's model. Answers are
// parsed, so a host that drifts from the domain shapes fails loudly here
// rather than rendering wrong figures.
export async function fetchScenario(id: string, modelId?: string): Promise<Session> {
  return sessionSchema.parse(await getApiTransport().call("getScenario", { id, modelId }));
}

export async function compareScenario(id: string, modelIds?: string[]): Promise<VendorComparison> {
  return vendorComparisonSchema.parse(await getApiTransport().call("compareScenario", { id, modelIds }));
}

export async function fetchVendorProfiles(): Promise<VendorProfileSummary[]> {
  return z.array(vendorProfileSummarySchema).parse(await getApiTransport().call("listVendorProfiles"));
}
