// Bundles the real-VS Code integration suite into out/integration/
// (`npm run test:integration` runs it first; step 10.9). The extension
// itself must already be built (`npm run build`): the suite runs dist/.
import { rmSync } from "node:fs";
import { build } from "esbuild";
import { integrationTestBundleOptions, integrationTestOutDir } from "./integration-test-options.mts";

rmSync(integrationTestOutDir, { recursive: true, force: true });
await build(integrationTestBundleOptions());
