// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { ColorModePreference } from "../lib/color-mode.js";
import { SegmentedControl } from "./ui/SegmentedControl.js";

const OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

interface ColorModeSwitchProps {
  preference: ColorModePreference;
  onChange: (preference: ColorModePreference) => void;
}

export function ColorModeSwitch({ preference, onChange }: ColorModeSwitchProps) {
  return (
    <SegmentedControl
      name="color-mode"
      label="Colour theme"
      options={OPTIONS}
      value={preference}
      onChange={onChange}
    />
  );
}
