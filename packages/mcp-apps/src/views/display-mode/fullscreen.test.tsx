// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { ViewBrand } from "../../brand/view-brand.js";
import type { HostContext } from "../../host/app-host-port.js";
import { FakeAppHostPort } from "../../host/fake-app-host-port.js";
import { axeViolations } from "../../test-support/axe.js";
import { costComparison, costSeries, costVariance } from "../../view-models/cost-analysis-fixtures.js";
import { costRollup, sessionCost, turnSeries } from "../../view-models/fixtures.js";
import { CostChangeView } from "../CostChangeView.js";
import { CostCompareView } from "../CostCompareView.js";
import { CostOverTimeView } from "../CostOverTimeView.js";
import { CostRollupView } from "../CostRollupView.js";
import { FindingsView } from "../FindingsView.js";
import { SessionCostView } from "../SessionCostView.js";
import { findingsResult, SAMPLE_FINDINGS } from "../findings/fixtures.js";

// Fullscreen for U2 and U9 (plan §8.3, A31). The control appears only when
// the host lists fullscreen; the fake host switches the mode the way Claude
// Desktop does (a request, then a host-context push with the new mode).

const brand: ViewBrand = { productId: "standalone", displayName: "Agent Cost Analyzer", version: "0.9.0" };
const CLAUDE: HostContext = { displayMode: "inline", availableDisplayModes: ["inline", "fullscreen"] };
const VSCODE: HostContext = { displayMode: "inline", availableDisplayModes: ["inline"] };
const FULLSCREEN = /^(Fullscreen|Exit fullscreen)$/;

function portWith(context: HostContext | undefined): FakeAppHostPort {
  const port = new FakeAppHostPort();
  port.toolResults.set("get_session_cost", { structuredContent: sessionCost() });
  port.toolResults.set("get_turn_series", { structuredContent: turnSeries() });
  if (context !== undefined) port.pushHostContext(context);
  return port;
}

const requests = (port: FakeAppHostPort) => port.calls.filter((call) => call.method === "requestDisplayMode").map((call) => call.args[0]);
const shell = () => document.querySelector("main.view-shell");

function renderU2(port: FakeAppHostPort) {
  return render(<CostRollupView port={port} brand={brand} result={{ structuredContent: costRollup() }} />);
}
function renderU9(port: FakeAppHostPort) {
  return render(<CostOverTimeView port={port} brand={brand} result={{ structuredContent: costSeries() }} />);
}

describe.each([
  ["U2 cost rollup", renderU2],
  ["U9 cost over time", renderU9],
])("%s fullscreen control", (_name, renderView) => {
  it("is hidden when the host lists only inline (VS Code)", () => {
    renderView(portWith(VSCODE));
    expect(screen.queryByRole("button", { name: FULLSCREEN })).toBeNull();
  });

  it("is hidden when the host sends no display modes", () => {
    renderView(portWith({}));
    expect(screen.queryByRole("button", { name: FULLSCREEN })).toBeNull();
  });

  it("is shown as Fullscreen when the host lists fullscreen, and pressing it requests fullscreen", async () => {
    const port = portWith(CLAUDE);
    renderView(port);
    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    expect(requests(port)).toEqual(["fullscreen"]);
  });

  it("reads Exit fullscreen after the host switches, and pressing it requests inline", async () => {
    const port = portWith(CLAUDE);
    renderView(port);
    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    await screen.findByRole("button", { name: "Exit fullscreen" });
    await userEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    expect(requests(port)).toEqual(["fullscreen", "inline"]);
    await screen.findByRole("button", { name: "Fullscreen" });
  });

  it("follows a display mode the host changes on its own", async () => {
    const port = portWith(CLAUDE);
    renderView(port);
    port.pushHostContext({ displayMode: "fullscreen" });
    await screen.findByRole("button", { name: "Exit fullscreen" });
    expect(shell()).toHaveAttribute("data-display-mode", "fullscreen");
    port.pushHostContext({ displayMode: "inline" });
    await screen.findByRole("button", { name: "Fullscreen" });
    expect(shell()).toHaveAttribute("data-display-mode", "inline");
  });

  it("keeps focus on the control after the switch", async () => {
    const port = portWith(CLAUDE);
    renderView(port);
    const control = screen.getByRole("button", { name: "Fullscreen" });
    control.focus();
    await userEvent.keyboard("{Enter}");
    const exit = await screen.findByRole("button", { name: "Exit fullscreen" });
    expect(exit).toBe(control);
    await waitFor(() => expect(document.activeElement).toBe(exit));
  });

  it("has no axe violations in inline or in fullscreen", async () => {
    const port = portWith(CLAUDE);
    const { container } = renderView(port);
    expect(await axeViolations(container)).toEqual([]);
    port.pushHostContext({ displayMode: "fullscreen" });
    await screen.findByRole("button", { name: "Exit fullscreen" });
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("views without fullscreen", () => {
  // A view that is not U2 or U9 never shows the control, even when the host offers it.
  it.each([
    ["U1 session cost", () => <SessionCostView port={portWith(CLAUDE)} brand={brand} result={{ structuredContent: sessionCost() }} />],
    ["U3 findings", () => <FindingsView port={portWith(CLAUDE)} brand={brand} result={{ structuredContent: findingsResult(SAMPLE_FINDINGS) }} />],
    ["cost compare",() => <CostCompareView port={portWith(CLAUDE)} brand={brand} result={{ structuredContent: costComparison() }} />],
    ["U11 cost change", () => <CostChangeView port={portWith(CLAUDE)} brand={brand} result={{ structuredContent: costVariance() }} />],
  ])("%s shows no fullscreen control", (_name, element) => {
    render(element());
    expect(screen.queryByRole("button", { name: FULLSCREEN })).toBeNull();
  });
});
