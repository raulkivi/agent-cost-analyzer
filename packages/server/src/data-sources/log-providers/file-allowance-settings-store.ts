// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import {
  allowanceSettingsWriteSchema,
  lenientAllowanceSettings,
  type AllowanceSettings,
  type AllowanceSettingsWrite,
} from "@agent-cost-analyzer/domain";
import type { AllowanceSettingsStore } from "../../services/monthly-allowance/allowance-settings-store.js";
import { readSettingsFile, writeSettingsFile, type SettingsFileFs } from "./settings-file.js";

const ALLOWANCE_KEY = "monthlyAllowance";

// The allowance under `monthlyAllowance` in the app's settings.json (D1).
// Writes go through the shared atomic writer, which keeps every other key.
export class FileAllowanceSettingsStore implements AllowanceSettingsStore {
  constructor(
    readonly settingsDir: string,
    private readonly fs?: SettingsFileFs,
  ) {}

  read(): AllowanceSettings {
    return lenientAllowanceSettings(readSettingsFile(this.settingsDir, this.fs)[ALLOWANCE_KEY]);
  }

  write(settings: AllowanceSettingsWrite): void {
    const valid = allowanceSettingsWriteSchema.parse(settings);
    writeSettingsFile(this.settingsDir, { [ALLOWANCE_KEY]: valid }, this.fs);
  }
}
