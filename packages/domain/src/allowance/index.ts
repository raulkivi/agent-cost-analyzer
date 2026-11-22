// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The monthly AI Credits allowance, shared by the extension and the
// standalone app (MA13, https://github.com/raulkivi/agent-cost-analyzer/blob/5d430c726b7c0fdf645056822a79c9b6542153bf/docs/plans/monthly-allowance-standalone.md §4.1, D8).
export { dayKeyOf, dayStartInstant } from "./day-key.js";
export { periodOf, type BillingPeriod } from "./billing-period.js";
export { billedCredits, knownCredits, knownSum, type CreditsOf, type KnownSum } from "./session-credits.js";
export {
  allowanceSettingsSchema,
  allowanceSettingsWriteSchema,
  DEFAULT_RESET_DAY,
  DEFAULT_WARN_AT_PERCENT,
  lenientAllowanceSettings,
  MAX_ALLOWANCE_AI_CREDITS,
  type AllowanceSettings,
  type AllowanceSettingsWrite,
} from "./allowance-settings.js";
export {
  ALLOWANCE_LEVELS,
  computeMonthlyAllowance,
  type AllowanceLevel,
  type HiddenAllowance,
  type MonthlyAllowanceFigures,
  type MonthlyAllowanceInput,
  type MonthlyAllowanceResult,
} from "./monthly-allowance.js";
export {
  allowanceLevelSchema,
  allowancePeriodSchema,
  allowanceStateSchema,
  copilotSourceSchema,
  copilotVariantSchema,
  coverageOnlyFiguresSchema,
  harnessFiguresSchema,
  knownAllowanceFiguresSchema,
  monthlyAllowanceAnswerSchema,
  type AllowanceState,
  type MonthlyAllowanceAnswer,
} from "./monthly-allowance-answer.js";
export {
  describeMonthlyAllowance,
  type AllowanceDescription,
  type AllowanceWordingState,
  type DescribeOptions,
  type MonthlyAllowanceDescription,
} from "./describe-monthly-allowance.js";
export { formatMessage, identityTranslate, type Translate } from "./translate.js";
