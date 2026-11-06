// Phase 15 step 15.9 (plan §12.4.1): the real standalone server and the
// web build, for one usage scenario. Run through tsx by the suite's app
// fixture (app-fixture.ts) with HOME set to a fresh temporary folder:
// it seeds the fixture home there, serves the API and packages/web/dist on
// an ephemeral loopback port, and prints {"port": n} once listening. The
// clock is fixed by AGENT_COST_ANALYZER_NOW (the server's clock port).
// Nothing here reaches the network.
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createApp } from "../../../server/src/app.ts";
import { clockFromEnv } from "../../../server/src/platform/clock/clock-from-env.ts";
import { createFixtureHome } from "./fixture-home.mts";

const dist = path.resolve(import.meta.dirname, "../../dist");
if (!existsSync(path.join(dist, "index.html"))) {
  throw new Error("packages/web/dist is not built: run `npm run build --workspace=packages/web` first");
}

const home = os.homedir();
if (!home.includes("aca-e2e-")) {
  throw new Error(`Refusing to seed a fixture home in ${home}: the suite sets HOME to a temporary aca-e2e- folder`);
}
const fixture = createFixtureHome(home, { projects: process.env.AGENT_COST_E2E_NO_PROJECTS !== "1" });

// Step 15.11: statements bill in UTC here, whatever the machine's zone.
const app = createApp({ appSettingsDir: fixture.appSettingsDir, now: clockFromEnv(), timeZone: "UTC" });
app.use(express.static(dist));
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(`${JSON.stringify({ port })}\n`);
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
