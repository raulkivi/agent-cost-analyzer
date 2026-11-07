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
  className?: string;
}

export function SegmentedControl<T extends string>({
  name,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<T>) {
  const classes = ["seg", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
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
