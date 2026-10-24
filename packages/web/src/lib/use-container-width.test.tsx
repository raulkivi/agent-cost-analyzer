import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContainerWidth } from "./use-container-width.js";

// A ResizeObserver stand-in the test drives by hand.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  resize(width: number): void {
    const entries = this.observed.map((target) => ({ target, contentRect: { width } }) as unknown as ResizeObserverEntry);
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

function Probe() {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="probe">
      {width === undefined ? "unmeasured" : String(width)}
    </div>
  );
}

describe("useContainerWidth", () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is unmeasured until the observer reports a size", () => {
    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("unmeasured");
  });

  it("observes the element the ref is attached to", () => {
    render(<Probe />);

    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0]!.observed).toEqual([screen.getByTestId("probe")]);
  });

  it("follows the element's width as it resizes", () => {
    render(<Probe />);
    const observer = FakeResizeObserver.instances[0]!;

    act(() => observer.resize(640));
    expect(screen.getByTestId("probe")).toHaveTextContent("640");

    act(() => observer.resize(1280));
    expect(screen.getByTestId("probe")).toHaveTextContent("1280");
  });

  it("stops observing on unmount", () => {
    const { unmount } = render(<Probe />);

    unmount();

    expect(FakeResizeObserver.instances[0]!.disconnected).toBe(true);
  });

  it("stays unmeasured where there is no ResizeObserver (old hosts, jsdom)", () => {
    vi.stubGlobal("ResizeObserver", undefined);

    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("unmeasured");
  });
});
