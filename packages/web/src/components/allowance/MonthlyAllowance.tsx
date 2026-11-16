// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import { allowanceView } from "../../lib/allowance/allowance-view.js";
import { useMonthlyAllowance } from "../../state/use-monthly-allowance.js";
import { AllowanceDetailsDialog } from "./AllowanceDetailsDialog.js";
import { AllowanceGauge } from "./AllowanceGauge.js";
import { AllowanceSettingsDialog, type AllowanceSaveOutcome } from "./AllowanceSettingsDialog.js";

interface MonthlyAllowanceProps {
  // The narrow layout of the panel (layoutFor), not the window's.
  narrow: boolean;
}

type OpenDialog = "none" | "details" | "settings";

const ANNOUNCEMENTS: Record<AllowanceSaveOutcome, string> = {
  saved: "Monthly allowance saved.",
  removed: "Monthly allowance removed.",
};

// The header gauge and its two dialogs (monthly-allowance-standalone.md §4.7).
// Mounted only in Analyze mode, and only by a product with the flag, so it
// loads when Analyze mode is entered (§4.8), after a save, and on Recount.
// Before the first answer, and where the product has no allowance (404), it
// draws nothing; a failed load is a muted "retry" button, not a hidden gauge.
export function MonthlyAllowance({ narrow }: MonthlyAllowanceProps) {
  const { load, reload, save } = useMonthlyAllowance();
  const [open, setOpen] = useState<OpenDialog>("none");
  const [announcement, setAnnouncement] = useState("");
  const gauge = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Whichever way the last dialog closes, focus goes back to the gauge (the
  // owner's decision 6: also after Change allowance, whose opener is gone).
  useEffect(() => {
    if (open === "none" && wasOpen.current) gauge.current?.focus();
    wasOpen.current = open !== "none";
  }, [open]);

  // Clearing first lets the same message be announced again next time.
  function show(next: OpenDialog): void {
    setAnnouncement("");
    setOpen(next);
  }

  if (load.status === "loading" || load.status === "unavailable") return null;
  if (load.status === "error") {
    return (
      <button type="button" className="btn btn-secondary allowance-gauge allowance-gauge--unset" onClick={reload} title={load.message}>
        <span className="allowance-gauge-text">Allowance unavailable. Retry</span>
      </button>
    );
  }

  const { answer } = load;
  const view = allowanceView(answer);

  return (
    <>
      <AllowanceGauge ref={gauge} view={view} narrow={narrow} onOpen={() => show(view.hasDetails ? "details" : "settings")} />
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {open === "details" && (
        <AllowanceDetailsDialog answer={answer} onClose={() => setOpen("none")} onRecount={reload} onChange={() => show("settings")} />
      )}
      {open === "settings" && (
        <AllowanceSettingsDialog
          answer={answer}
          onSave={save}
          onDone={(outcome) => {
            setAnnouncement(ANNOUNCEMENTS[outcome]);
            setOpen("none");
          }}
          onClose={() => setOpen("none")}
        />
      )}
    </>
  );
}
