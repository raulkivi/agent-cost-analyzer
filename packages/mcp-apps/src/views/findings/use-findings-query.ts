// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from "react";
import type { FindingKind, FindingSeverity, FindingsQueryResult } from "@agent-cost-analyzer/domain";
import type { AppHostPort } from "../../host/app-host-port.js";
import type { FindingsFilter } from "../../view-models/findings.js";
import { parseFindingsResult } from "./parse-findings-result.js";

// The state behind U3's filters (plan §4.3): the displayed result, the
// filter it answers, and the call in flight. A filter change calls
// list_findings again; until the answer lands the previous result stays on
// screen, and a failure leaves it there too.

export type QueryStatus = { state: "idle" } | { state: "loading" } | { state: "error"; retry: FindingsFilter };

const KINDS: readonly string[] = ["security", "anomaly", "behavior-change", "price-change"];
const SEVERITIES: readonly string[] = ["info", "low", "medium", "high", "critical"];

// The part of the model's own arguments the view does not change (the
// window, the provider, the limits) is carried into every new call.
function filterFromInput(input: Record<string, unknown>): FindingsFilter {
  const filter: FindingsFilter = {};
  if (Array.isArray(input.kind)) {
    const kinds = input.kind.filter((k): k is FindingKind => typeof k === "string" && KINDS.includes(k));
    if (kinds.length > 0) filter.kind = kinds;
  }
  if (typeof input.minSeverity === "string" && SEVERITIES.includes(input.minSeverity)) {
    filter.minSeverity = input.minSeverity as FindingSeverity;
  }
  return filter;
}

export function toolArguments(input: Record<string, unknown>, filter: FindingsFilter): Record<string, unknown> {
  const rest = { ...input };
  delete rest.kind;
  delete rest.minSeverity;
  return {
    ...rest,
    ...(filter.kind && filter.kind.length > 0 ? { kind: filter.kind } : {}),
    ...(filter.minSeverity && filter.minSeverity !== "info" ? { minSeverity: filter.minSeverity } : {}),
  };
}

interface Fetched {
  basedOn: FindingsQueryResult;
  result: FindingsQueryResult;
  filter: FindingsFilter;
}

export function useFindingsQuery(port: AppHostPort, initial: FindingsQueryResult | undefined) {
  const [input, setInput] = useState<Record<string, unknown>>({});
  const [fetched, setFetched] = useState<Fetched | undefined>();
  const [status, setStatus] = useState<QueryStatus>({ state: "idle" });
  const latestRequest = useRef(0);

  useEffect(() => port.onToolInput(setInput), [port]);

  // A newer host result replaces whatever an earlier filter fetched.
  const current = fetched && fetched.basedOn === initial ? fetched : undefined;
  const result = current?.result ?? initial;
  const filter = current?.filter ?? filterFromInput(input);

  const select = useCallback(
    (next: FindingsFilter): void => {
      const request = ++latestRequest.current;
      setStatus({ state: "loading" });
      const fail = (): void => {
        if (request === latestRequest.current) setStatus({ state: "error", retry: next });
      };
      port
        .callTool("list_findings", toolArguments(input, next))
        .then((reply) => {
          if (request !== latestRequest.current) return;
          const parsed = reply.isError ? undefined : parseFindingsResult(reply.structuredContent);
          if (!parsed || !initial) return fail();
          setFetched({ basedOn: initial, result: parsed, filter: next });
          setStatus({ state: "idle" });
        })
        .catch(fail);
    },
    [port, input, initial],
  );

  return { result, filter, status, select };
}
