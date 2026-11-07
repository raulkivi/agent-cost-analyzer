// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { fileURLToPath } from "node:url";

// The server's vendor profiles, with the bundled price book beside them, laid
// out as the extension ships both in media/ (step 15.13's MCP services).
export const FIXTURE_VENDOR_PROFILES_DIR = fileURLToPath(new URL("../../fixtures/vendor-profiles", import.meta.url));
