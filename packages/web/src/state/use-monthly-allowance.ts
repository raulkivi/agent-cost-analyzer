// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef, useState } from "react";
import type { AllowanceSettingsWrite, MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { AllowanceUnavailable, getMonthlyAllowance, setMonthlyAllowance } from "../api-client/monthly-allowance.js";

// MS7 (https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c/docs/plans/monthly-allowance-standalone.md §4.8): loads once when the gauge
// mounts (entering Analyze mode), again on `reload` (Recount) and after a
// save. No timer, no polling. A reload keeps the last answer on screen, so the
// gauge never flickers to "loading" on Recount.
export type AllowanceLoad =
  | { status: "loading" }
  // 404: this product, or this older server, has no allowance: show nothing.
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; answer: MonthlyAllowanceAnswer };

export interface MonthlyAllowanceHandle {
  load: AllowanceLoad;
  reload: () => void;
  // Resolves with the fresh answer; rejects with AllowanceSettingsRejected on a 400.
  save: (settings: AllowanceSettingsWrite) => Promise<MonthlyAllowanceAnswer>;
}

export function useMonthlyAllowance(): MonthlyAllowanceHandle {
  const [load, setLoad] = useState<AllowanceLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getMonthlyAllowance(controller.signal)
      .then((answer) => setLoad({ status: "ready", answer }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad(
          error instanceof AllowanceUnavailable
            ? { status: "unavailable" }
            : { status: "error", message: error instanceof Error ? error.message : "The monthly allowance could not be loaded." },
        );
      });
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => setAttempt((current) => current + 1), []);

  const save = useCallback(async (settings: AllowanceSettingsWrite) => {
    const answer = await setMonthlyAllowance(settings);
    if (mounted.current) setLoad({ status: "ready", answer });
    return answer;
  }, []);

  return { load, reload, save };
}
