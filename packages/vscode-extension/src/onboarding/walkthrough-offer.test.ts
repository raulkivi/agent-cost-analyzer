import { describe, expect, it, vi } from "vitest";
import { WalkthroughOffer, WALKTHROUGH_OFFERED_KEY } from "./walkthrough-offer.js";

function setup(initial: Record<string, unknown> = {}) {
  const state = new Map<string, unknown>(Object.entries(initial));
  const memento = {
    get: (key: string) => state.get(key),
    update: vi.fn(async (key: string, value: unknown) => void state.set(key, value)),
  };
  const walkthrough = { open: vi.fn(async () => undefined) };
  const onError = vi.fn();
  return { offer: new WalkthroughOffer(memento, walkthrough, { onError }), memento, walkthrough, onError, state };
}

describe("WalkthroughOffer (vscode-extension.md §3.5 Onboarding)", () => {
  it("opens the walkthrough on the first activation, with no notification", async () => {
    const { offer, walkthrough } = setup();

    await offer.offerOnce();

    expect(walkthrough.open).toHaveBeenCalledTimes(1);
  });

  it("remembers that it offered, in the extension's global state", async () => {
    const { offer, state } = setup();

    await offer.offerOnce();

    expect(state.get(WALKTHROUGH_OFFERED_KEY)).toBe(true);
  });

  it("never offers it again after that, in this session or a later one", async () => {
    const { offer, walkthrough } = setup();

    await offer.offerOnce();
    await offer.offerOnce();
    await new WalkthroughOffer({ get: () => true, update: async () => undefined }, walkthrough).offerOnce();

    expect(walkthrough.open).toHaveBeenCalledTimes(1);
  });

  it("does not offer it when it was offered before", async () => {
    const { offer, walkthrough } = setup({ [WALKTHROUGH_OFFERED_KEY]: true });

    await offer.offerOnce();

    expect(walkthrough.open).not.toHaveBeenCalled();
  });

  it("remembers the offer before opening, so a failing editor doesn't turn into a retry at every start", async () => {
    const { offer, walkthrough, memento, onError } = setup();
    const order: string[] = [];
    memento.update.mockImplementation(async () => void order.push("remember"));
    walkthrough.open.mockImplementation(async () => {
      order.push("open");
      throw new Error("no editor");
    });

    await expect(offer.offerOnce()).resolves.toBeUndefined();

    expect(order).toEqual(["remember", "open"]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "no editor" }));
  });

  it("opens nothing, and reports it, when the state can't be saved (it couldn't be kept from repeating)", async () => {
    const { offer, walkthrough, memento, onError } = setup();
    memento.update.mockRejectedValue(new Error("disk full"));

    await expect(offer.offerOnce()).resolves.toBeUndefined();

    expect(walkthrough.open).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "disk full" }));
  });
});
