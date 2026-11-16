// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { AllowanceSettingsWrite, MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import { AllowanceSettingsRejected, type AllowanceField } from "../../api-client/monthly-allowance.js";
import { settingsDialogDefaults } from "../../lib/allowance/allowance-view.js";
import { useEscapeKey, useFocusTrap } from "../../lib/focus.js";

export type AllowanceSaveOutcome = "saved" | "removed";

interface AllowanceSettingsDialogProps {
  answer: MonthlyAllowanceAnswer;
  // Writes the settings; rejects with AllowanceSettingsRejected on a 400.
  onSave: (settings: AllowanceSettingsWrite) => Promise<unknown>;
  onDone: (outcome: AllowanceSaveOutcome) => void;
  onClose: () => void;
}

type FieldErrors = Partial<Record<AllowanceField, string>>;

interface Problems {
  fields: FieldErrors;
  other: string[];
}

const FIELD_ORDER: readonly AllowanceField[] = ["aiCredits", "resetDay", "warnAtPercent"];

const NOTHING_SAVED = "Nothing was saved. The gauge is unchanged.";

// Text to a number, or undefined when it is not one: the server owns the
// ranges and answers a 400 with a message per field.
function numberOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

// Settings.dc.html: allowance, reset day and warn percent, with Remove
// allowance. Focus lands on the allowance field; a 400 puts each message
// beside its field (aria-invalid, aria-describedby, a mark besides color)
// and moves focus to the first invalid one. Nothing is saved on a 400.
export function AllowanceSettingsDialog({ answer, onSave, onDone, onClose }: AllowanceSettingsDialogProps) {
  const dialog = useRef<HTMLFormElement>(null);
  const inputs = useRef<Partial<Record<AllowanceField, HTMLInputElement | null>>>({});
  const ids = { title: useId(), hint: useId(), aiCredits: useId(), resetDay: useId(), warnAtPercent: useId() };
  useFocusTrap(dialog);
  useEscapeKey(onClose);

  const [values, setValues] = useState(() => settingsDialogDefaults(answer));
  const [problems, setProblems] = useState<Problems | null>(null);
  const [saving, setSaving] = useState(false);
  const [removeHinted, setRemoveHinted] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // After a rejection, the first invalid field takes focus.
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => problems?.fields[field] !== undefined);
    if (first) inputs.current[first]?.focus();
  }, [problems]);

  const hasAllowance = answer.settings.aiCredits !== null;

  async function write(settings: AllowanceSettingsWrite, outcome: AllowanceSaveOutcome): Promise<void> {
    setSaving(true);
    setProblems(null);
    try {
      await onSave(settings);
      onDone(outcome);
    } catch (error) {
      if (!mounted.current) return;
      if (error instanceof AllowanceSettingsRejected) {
        setProblems({ fields: error.fieldErrors, other: error.otherErrors });
      } else {
        setProblems({ fields: {}, other: [`The allowance could not be saved: ${error instanceof Error ? error.message : "unknown error"}`] });
      }
      setSaving(false);
    }
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    const aiCredits = numberOf(values.aiCredits);
    const resetDay = numberOf(values.resetDay);
    const warnAtPercent = numberOf(values.warnAtPercent);
    const fields: FieldErrors = {};
    if (aiCredits === undefined) fields.aiCredits = "Enter a number above 0, or use Remove allowance.";
    if (resetDay === undefined) fields.resetDay = "Enter a whole number from 1 to 28.";
    if (warnAtPercent === undefined) fields.warnAtPercent = "Enter a whole number.";
    if (aiCredits === undefined || resetDay === undefined || warnAtPercent === undefined) {
      setProblems({ fields, other: [] });
      return;
    }
    void write({ aiCredits, resetDay, warnAtPercent }, "saved");
  }

  // One click, no confirm step: retyping the number restores it. The reset
  // day and threshold that are kept are the saved ones, not unsent edits.
  function remove(): void {
    void write({ aiCredits: null, resetDay: answer.settings.resetDay, warnAtPercent: answer.settings.warnAtPercent }, "removed");
  }

  function field(name: AllowanceField, label: string, placeholder: string | undefined, inputMode: "decimal" | "numeric") {
    const error = problems?.fields[name];
    const errorId = `${ids[name]}-error`;
    return (
      <div className="field allowance-field">
        <label htmlFor={ids[name]}>{label}</label>
        <input
          ref={(element) => {
            inputs.current[name] = element;
          }}
          id={ids[name]}
          className="input"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          placeholder={placeholder}
          value={values[name]}
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={error !== undefined ? errorId : undefined}
          onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
        />
        {error !== undefined && (
          <span id={errorId} className="allowance-field-error" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" data-testid="allowance-settings-backdrop">
      <form
        ref={dialog}
        className="dialog allowance-dialog allowance-dialog--settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        noValidate
        onSubmit={submit}
      >
        <div id={ids.title} className="dialog-title">
          Monthly allowance
        </div>
        <p className="allowance-prose">Set it to match your GitHub billing page. Stored in this app’s settings folder only.</p>
        {field("aiCredits", "Monthly allowance (AI Credits)", "a number above 0", "decimal")}
        {field("resetDay", "Reset day (1 to 28)", undefined, "numeric")}
        {field("warnAtPercent", "Warn at (percent of allowance)", undefined, "numeric")}
        {problems !== null && (
          <div className="allowance-note" role="alert">
            {problems.other.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p>{NOTHING_SAVED}</p>
          </div>
        )}
        {/* Always read by screen readers; drawn only while Remove is focused or hovered. */}
        {/* The slot keeps the hint's room, so showing it never moves the buttons from under the pointer. */}
        <div className="allowance-hint-slot">
          <p id={ids.hint} className={removeHinted ? "allowance-hint" : "allowance-hint sr-only"}>
            Remove allowance hides the gauge. The reset day and warn percent are kept.
          </p>
        </div>
        <div className="dialog-actions allowance-actions allowance-actions--settings">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!hasAllowance || saving}
            aria-describedby={ids.hint}
            onClick={remove}
            onFocus={() => setRemoveHinted(true)}
            onBlur={() => setRemoveHinted(false)}
            onMouseEnter={() => setRemoveHinted(true)}
            onMouseLeave={() => setRemoveHinted(false)}
          >
            Remove allowance
          </button>
          <button type="button" className="btn btn-secondary allowance-cancel" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
