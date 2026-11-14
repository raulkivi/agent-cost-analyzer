// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  name: string;
  options: readonly SegmentedControlOption<T>[];
  value: T;
  onChange: (value: T) => void;
  // Names the group for assistive tech; when given the group is exposed as
  // a radiogroup. Optional so existing unnamed controls are unchanged.
  label?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  name,
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const classes = ["seg", className].filter(Boolean).join(" ");

  return (
    <div className={classes} role={label ? "radiogroup" : undefined} aria-label={label}>
      {options.map((option) => (
        <label key={option.value} className="seg-opt">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
