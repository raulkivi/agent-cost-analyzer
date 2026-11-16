// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthlyAllowanceAnswer } from "@agent-cost-analyzer/domain";
import * as client from "../../api-client/monthly-allowance.js";
import {
  atLeastNearAnswer,
  knownAnswer,
  nearAnswer,
  noSessionsAnswer,
  noSourceAnswer,
  notSetAnswer,
  overAnswer,
  unknownAnswer,
} from "../../test-support/allowance-fixture.js";
import { MonthlyAllowance } from "./MonthlyAllowance.js";

vi.mock("../../api-client/monthly-allowance.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api-client/monthly-allowance.js")>()),
  getMonthlyAllowance: vi.fn(),
  setMonthlyAllowance: vi.fn(),
}));

const get = vi.mocked(client.getMonthlyAllowance);
const put = vi.mocked(client.setMonthlyAllowance);

async function shown(answer: MonthlyAllowanceAnswer, narrow = false) {
  get.mockResolvedValue(answer);
  const view = render(<MonthlyAllowance narrow={narrow} />);
  await waitFor(() => expect(screen.queryByRole("button")).not.toBeNull());
  return view;
}

const gauge = () => screen.getByRole("button", { name: /AI Credits this month|Near limit|Over the allowance|No sessions|Set monthly allowance/ });

beforeEach(() => {
  get.mockReset();
  put.mockReset();
});

describe("MonthlyAllowance: the gauge in each state (§4.7)", () => {
  it("normal: figure first, no level word, a meter that is not exact-looking only when partial", async () => {
    const { container } = await shown(knownAnswer());

    expect(gauge()).toHaveTextContent("312.40 of 1,000 AI Credits");
    expect(gauge()).not.toHaveTextContent("limit");
    expect(container.querySelector(".allowance-meter")).not.toBeNull();
    expect(container.querySelector(".allowance-meter-open")).toBeNull();
  });

  it("near: level last, in words", async () => {
    await shown(nearAnswer());

    expect(gauge()).toHaveTextContent("812.40 of 1,000 AI Credits · near limit");
    expect(gauge()).toHaveAccessibleName(/^Near limit\. AI Credits this month: 812\.40 of 1,000 allowance, 81 percent/);
  });

  it("over: the cap sticks out past a full meter", async () => {
    const { container } = await shown(overAnswer());

    expect(gauge()).toHaveTextContent("1,042.10 of 1,000 AI Credits · over");
    expect(container.querySelector(".allowance-meter-cap")).not.toBeNull();
  });

  it("at least: says so, and the meter ends in an open end", async () => {
    const { container } = await shown(atLeastNearAnswer());

    expect(gauge()).toHaveTextContent("at least 812.40 of 1,000 AI Credits · near limit");
    expect(container.querySelector(".allowance-meter-open")).not.toBeNull();
  });

  it("unknown: words only, never '0 of', no meter", async () => {
    const { container } = await shown(unknownAnswer());

    expect(gauge()).toHaveTextContent("AI Credits this month: unknown");
    expect(container).not.toHaveTextContent(/\b0 of\b/);
    expect(container.querySelector(".allowance-meter")).toBeNull();
  });

  it("no sessions and no source: words only, no meter", async () => {
    const first = await shown(noSessionsAnswer());
    expect(gauge()).toHaveTextContent("No sessions this month");
    expect(first.container.querySelector(".allowance-meter")).toBeNull();
    first.unmount();

    const second = await shown(noSourceAnswer());
    expect(gauge()).toHaveTextContent("AI Credits this month: no Copilot logs");
    expect(second.container.querySelector(".allowance-meter")).toBeNull();
  });

  it("not set: a muted button named by its text, with no label of its own", async () => {
    await shown(notSetAnswer());

    const button = screen.getByRole("button", { name: "Set monthly allowance" });
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).toHaveClass("allowance-gauge--unset");
  });

  it("draws nothing while loading, and where the product has no allowance (404)", async () => {
    get.mockReturnValue(new Promise(() => undefined));
    const loading = render(<MonthlyAllowance narrow={false} />);
    expect(loading.container).toBeEmptyDOMElement();
    loading.unmount();

    get.mockRejectedValue(new client.AllowanceUnavailable());
    const { container } = render(<MonthlyAllowance narrow={false} />);
    await act(async () => undefined);
    expect(container).toBeEmptyDOMElement();
  });

  it("a failed load is a retry button that loads again", async () => {
    get.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(knownAnswer());
    render(<MonthlyAllowance narrow={false} />);

    await userEvent.click(await screen.findByRole("button", { name: "Allowance unavailable. Retry" }));

    expect(await screen.findByText("312.40 of 1,000 AI Credits")).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("loads once when mounted: no timer, no polling", async () => {
    vi.useFakeTimers();
    try {
      get.mockResolvedValue(knownAnswer());
      render(<MonthlyAllowance narrow={false} />);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MonthlyAllowance: narrow layout (§4.7, owner decision 2026-11-15)", () => {
  it("keeps the figure and a short 'near' beside the meter, and the full label in the aria-label", async () => {
    const { container } = await shown(atLeastNearAnswer(), true);

    expect(gauge()).toHaveClass("allowance-gauge--narrow");
    expect(within(gauge()).getByText("at least 812.40 of 1,000 AI Credits")).toBeVisible();
    expect(within(gauge()).getByText("near").tagName).toBe("B");
    expect(gauge()).not.toHaveTextContent("near limit");
    expect(container.querySelector(".allowance-gauge-meter-row .allowance-meter")).not.toBeNull();
    expect(gauge()).toHaveAccessibleName(/^Near limit\./);
  });

  it("over keeps the short word 'over'", async () => {
    await shown(overAnswer(), true);

    expect(within(gauge()).getByText("over").tagName).toBe("B");
  });

  it("a normal month has the figure and the meter and no word", async () => {
    await shown(knownAnswer(), true);

    expect(gauge()).toHaveTextContent(/^312\.40 of 1,000 AI Credits$/);
  });

  it("states without a figure stay one line of words", async () => {
    await shown(unknownAnswer(), true);

    expect(gauge()).toHaveTextContent(/^AI Credits this month: unknown$/);
  });
});

describe("MonthlyAllowance: details dialog", () => {
  it("opens on click with the lead, the rows, the by-harness split and what is not counted", async () => {
    await shown(nearAnswer());

    await userEvent.click(gauge());

    const dialog = screen.getByRole("dialog", { name: "Monthly allowance" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText("81 % of the allowance used")).toBeInTheDocument();
    expect(within(dialog).getByText("Up to 187.60 AI Credits remain")).toBeInTheDocument();
    expect(within(dialog).getByText("80 % of the allowance")).toBeInTheDocument();
    expect(within(dialog).getByText("Agent Host and Copilot CLI")).toBeInTheDocument();
    expect(within(dialog).getByText("Not counted")).toBeInTheDocument();
    expect(within(dialog).getByText("Sessions whose logs Copilot already pruned.")).toBeInTheDocument();
    expect(within(dialog).getByText("VS Code Insiders")).toBeInTheDocument();
  });

  it("opens from the keyboard with Enter and with Space, and Escape closes it", async () => {
    await shown(knownAnswer());
    const user = userEvent.setup();

    gauge().focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("puts focus on Close, cycles Tab inside, and gives focus back to the gauge on close", async () => {
    await shown(knownAnswer());
    const user = userEvent.setup();
    await user.click(gauge());

    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Recount" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Change allowance" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gauge()).toHaveFocus();
  });

  it("partial: the boxed 'may be higher' note and 'at least' per harness", async () => {
    await shown(atLeastNearAnswer());
    await userEvent.click(gauge());

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("The total may be higher: sessions without cost data are not counted.")).toBeInTheDocument();
    expect(within(dialog).getByText("At least 81 % of the allowance used")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("cell", { name: /^at least \d/ })).toHaveLength(2);
  });

  it("over: 'No AI Credits remain' and one harness row only", async () => {
    await shown(overAnswer());
    await userEvent.click(gauge());

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("No AI Credits remain")).toBeInTheDocument();
    expect(within(dialog).queryByText("Agent Host and Copilot CLI")).toBeNull();
  });

  it("unknown: the note says unknown is not 0, harness rows say 'unknown', no percent", async () => {
    await shown(unknownAnswer());
    await userEvent.click(gauge());

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("No session this month has cost data, so no total is shown. Unknown is not 0.")).toBeInTheDocument();
    expect(within(dialog).getAllByText("unknown")).toHaveLength(2);
    expect(dialog).not.toHaveTextContent("%");
  });

  it("no sessions: says so in words and still lists what is not counted", async () => {
    await shown(noSessionsAnswer());
    await userEvent.click(gauge());

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("No Copilot session started in this period on this machine.")).toBeInTheDocument();
    expect(within(dialog).getByText("0 sessions this month")).toBeInTheDocument();
    expect(within(dialog).getByText("Not counted")).toBeInTheDocument();
  });

  it("no source: names the missing logs and the source as not available", async () => {
    await shown(noSourceAnswer());
    await userEvent.click(gauge());

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("No Copilot Chat logs found on this machine.")).toBeInTheDocument();
    expect(within(dialog).getByText("VS Code: not available")).toBeInTheDocument();
  });

  it("Recount loads again and keeps the dialog open with the new answer", async () => {
    await shown(nearAnswer());
    await userEvent.click(gauge());
    get.mockResolvedValue(overAnswer());

    await userEvent.click(screen.getByRole("button", { name: "Recount" }));

    await waitFor(() => expect(within(screen.getByRole("dialog")).getByText("No AI Credits remain")).toBeInTheDocument());
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("clicking outside closes it", async () => {
    await shown(knownAnswer());
    await userEvent.click(gauge());

    fireEvent.click(screen.getByTestId("allowance-details-backdrop"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("MonthlyAllowance: settings dialog", () => {
  it("not set: the gauge opens the settings dialog, focus on an empty allowance field, Remove disabled", async () => {
    await shown(notSetAnswer());

    await userEvent.click(gauge());

    const dialog = screen.getByRole("dialog", { name: "Monthly allowance" });
    const allowance = within(dialog).getByLabelText("Monthly allowance (AI Credits)");
    expect(allowance).toHaveFocus();
    expect(allowance).toHaveValue("");
    expect(allowance).toHaveAttribute("placeholder", "a number above 0");
    expect(within(dialog).getByLabelText("Reset day (1 to 28)")).toHaveValue("1");
    expect(within(dialog).getByLabelText("Warn at (percent of allowance)")).toHaveValue("80");
    expect(within(dialog).getByRole("button", { name: "Remove allowance" })).toBeDisabled();
    expect(within(dialog).getByText("Set it to match your GitHub billing page. Stored in this app’s settings folder only.")).toBeInTheDocument();
  });

  it("Change allowance closes the details and opens settings filled with the saved values", async () => {
    await shown(knownAnswer({}, { settings: { resetDay: 15, warnAtPercent: 90 } }));
    await userEvent.click(gauge());

    await userEvent.click(screen.getByRole("button", { name: "Change allowance" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByLabelText("Monthly allowance (AI Credits)")).toHaveValue("1000");
    expect(screen.getByLabelText("Reset day (1 to 28)")).toHaveValue("15");
    expect(screen.getByLabelText("Warn at (percent of allowance)")).toHaveValue("90");
  });

  it("Save writes the three numbers, refreshes the gauge from the response, announces it and returns focus to the gauge", async () => {
    await shown(notSetAnswer());
    put.mockResolvedValue(knownAnswer());
    const user = userEvent.setup();
    await user.click(gauge());

    await user.type(screen.getByLabelText("Monthly allowance (AI Credits)"), "1000");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(put).toHaveBeenCalledWith({ aiCredits: 1000, resetDay: 1, warnAtPercent: 80 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(gauge()).toHaveTextContent("312.40 of 1,000 AI Credits");
    expect(screen.getByRole("status")).toHaveTextContent("Monthly allowance saved.");
    expect(gauge()).toHaveFocus();
    // The save's response is the new answer: no second GET (§4.8 after a save).
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("Cancel and Escape close without writing and return focus to the gauge", async () => {
    await shown(notSetAnswer());
    const user = userEvent.setup();

    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(gauge()).toHaveFocus();

    await user.click(gauge());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(gauge()).toHaveFocus();
    expect(put).not.toHaveBeenCalled();
  });

  it("Change allowance, then Cancel: focus goes to the gauge, not the vanished details button", async () => {
    await shown(knownAnswer());
    const user = userEvent.setup();
    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Change allowance" }));

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(gauge()).toHaveFocus();
  });

  it("a 400 shows each message beside its field, marks it invalid, focuses the first and keeps the dialog open", async () => {
    await shown(knownAnswer());
    put.mockRejectedValue(
      new client.AllowanceSettingsRejected(
        { aiCredits: "Allowance must be above 0 and at most 1,000,000,000.", resetDay: "Reset day must be a whole number from 1 to 28." },
        [],
      ),
    );
    const user = userEvent.setup();
    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Change allowance" }));
    const allowance = screen.getByLabelText("Monthly allowance (AI Credits)");
    await user.clear(allowance);
    await user.type(allowance, "0");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const resetDay = screen.getByLabelText("Reset day (1 to 28)");
    await waitFor(() => expect(allowance).toHaveFocus());
    expect(allowance).toBeInvalid();
    expect(resetDay).toBeInvalid();
    expect(screen.getByLabelText("Warn at (percent of allowance)")).toBeValid();
    expect(allowance).toHaveAccessibleDescription("Allowance must be above 0 and at most 1,000,000,000.");
    expect(resetDay).toHaveAccessibleDescription("Reset day must be a whole number from 1 to 28.");
    expect(screen.getByText("Nothing was saved. The gauge is unchanged.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(gauge()).toHaveTextContent("312.40 of 1,000 AI Credits");
  });

  it("a 400 with no field named shows its message above the buttons", async () => {
    await shown(knownAnswer());
    put.mockRejectedValue(new client.AllowanceSettingsRejected({}, ["Unknown setting."]));
    const user = userEvent.setup();
    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Change allowance" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Unknown setting.")).toBeInTheDocument();
    expect(screen.getByText("Nothing was saved. The gauge is unchanged.")).toBeInTheDocument();
  });

  it("a blank allowance is a field error, not a write", async () => {
    await shown(notSetAnswer());
    const user = userEvent.setup();
    await user.click(gauge());

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(put).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Monthly allowance (AI Credits)")).toBeInvalid();
    expect(screen.getByText("Enter a number above 0, or use Remove allowance.")).toBeInTheDocument();
  });

  it("any other failure shows a message and keeps the dialog", async () => {
    await shown(knownAnswer());
    put.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Change allowance" }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("The allowance could not be saved: network down")).toBeInTheDocument();
  });

  it("Remove allowance is one click, keeps the saved reset day and threshold, and the gauge becomes the not-set prompt", async () => {
    await shown(knownAnswer({}, { settings: { resetDay: 15, warnAtPercent: 90 } }));
    put.mockResolvedValue(notSetAnswer());
    const user = userEvent.setup();
    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Change allowance" }));
    // An unsent edit is not what gets kept.
    await user.type(screen.getByLabelText("Reset day (1 to 28)"), "9");

    await user.click(screen.getByRole("button", { name: "Remove allowance" }));

    expect(put).toHaveBeenCalledWith({ aiCredits: null, resetDay: 15, warnAtPercent: 90 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Set monthly allowance" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Monthly allowance removed.");
  });

  it("describes Remove allowance for screen readers, and shows the hint when it is focused", async () => {
    await shown(knownAnswer());
    const user = userEvent.setup();
    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Change allowance" }));
    const remove = screen.getByRole("button", { name: "Remove allowance" });

    expect(remove).toHaveAccessibleDescription("Remove allowance hides the gauge. The reset day and warn percent are kept.");
    expect(screen.getByText(/^Remove allowance hides the gauge/)).toHaveClass("sr-only");
    remove.focus();
    expect(await screen.findByText(/^Remove allowance hides the gauge/)).not.toHaveClass("sr-only");
  });

  it("Tab cycles through the fields and buttons in the board's order", async () => {
    await shown(knownAnswer());
    const user = userEvent.setup();
    await user.click(gauge());
    await user.click(screen.getByRole("button", { name: "Change allowance" }));

    const order = [
      screen.getByLabelText("Monthly allowance (AI Credits)"),
      screen.getByLabelText("Reset day (1 to 28)"),
      screen.getByLabelText("Warn at (percent of allowance)"),
      screen.getByRole("button", { name: "Remove allowance" }),
      screen.getByRole("button", { name: "Cancel" }),
      screen.getByRole("button", { name: "Save" }),
    ];
    for (const element of order) {
      expect(element).toHaveFocus();
      await user.tab();
    }
    expect(screen.getByLabelText("Monthly allowance (AI Credits)")).toHaveFocus();
  });
});
