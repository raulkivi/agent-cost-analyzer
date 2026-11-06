import type { ReactNode } from "react";
import type { CostBucket, PricingMode } from "@agent-cost-analyzer/domain";
import type { DisplayUnit } from "../../lib/cost/cost-format.js";
import { RANGE_PRESETS, type RangePreset } from "../../lib/cost/date-ranges.js";
import { SegmentedControl } from "../ui/SegmentedControl.js";

// Phase 15 step 15.9 (plan §11.2, dataviz "filters in one row above the
// charts"): the cost tabs' filter row: the date range first, with presets,
// then the bucket (Cost over time only), the unit and the pricing mode.

export interface CostFilterState {
  preset: RangePreset;
  bucket: CostBucket;
  unit: DisplayUnit;
  pricing: PricingMode;
}

const BUCKETS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

const UNITS = [
  { value: "AI_CREDITS", label: "AI Credits" },
  { value: "USD", label: "USD" },
] as const;

const PRICING = [
  { value: "as-of-use", label: "As of use" },
  { value: "today", label: "Today's prices" },
] as const;

interface CostFiltersProps {
  name: string; // radio-group name prefix, unique per tab
  label: string;
  state: CostFilterState;
  onChange: (state: CostFilterState) => void;
  showBucket?: boolean;
  children?: ReactNode; // extra controls (Compare's Group by)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="cost-filter" role="radiogroup" aria-label={label}>
      {children}
    </div>
  );
}

export function CostFilters({ name, label, state, onChange, showBucket = true, children }: CostFiltersProps) {
  return (
    <div className="cost-filters" role="group" aria-label={label}>
      <Field label="Date range">
        <SegmentedControl name={`${name}-range`} options={RANGE_PRESETS} value={state.preset} onChange={(preset) => onChange({ ...state, preset })} />
      </Field>
      {showBucket && (
        <Field label="Bucket">
          <SegmentedControl name={`${name}-bucket`} options={BUCKETS} value={state.bucket} onChange={(bucket) => onChange({ ...state, bucket })} />
        </Field>
      )}
      {children}
      <Field label="Currency">
        <SegmentedControl name={`${name}-unit`} options={UNITS} value={state.unit} onChange={(unit) => onChange({ ...state, unit })} />
      </Field>
      <Field label="Pricing">
        <SegmentedControl name={`${name}-pricing`} options={PRICING} value={state.pricing} onChange={(pricing) => onChange({ ...state, pricing })} />
      </Field>
    </div>
  );
}

export function costKicker(parts: readonly string[]): string {
  return parts.join(" · ");
}

export const BUCKET_ADVERB: Record<CostBucket, string> = { day: "daily", week: "weekly", month: "monthly" };
export const PRICING_LABEL: Record<PricingMode, string> = { "as-of-use": "as of use", today: "at today's prices" };
