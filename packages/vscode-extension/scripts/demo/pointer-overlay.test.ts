// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { describe, expect, it } from "vitest";
import { POINTER_OVERLAY_SCRIPT } from "./pointer-overlay.mts";

type FakeEl = {
  tag: string;
  ns?: string;
  attrs: Record<string, string>;
  id: string;
  style: Record<string, string>;
  children: FakeEl[];
  innerHTML: string;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeEl): FakeEl;
  remove(): void;
};

function fakeEl(tag: string, ns?: string): FakeEl {
  const el: FakeEl = {
    tag,
    ns,
    attrs: {},
    id: "",
    style: {},
    children: [],
    innerHTML: "",
    removed: false,
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    remove() {
      el.removed = true;
    },
  };
  return el;
}

function fakeDocument(root: FakeEl) {
  return { documentElement: root, createElement: (tag: string) => fakeEl(tag), createElementNS: (ns: string, tag: string) => fakeEl(tag, ns), getElementById: (id: string) => root.children.find((c) => c.id === id) ?? null };
}

function install() {
  const root = fakeEl("html");
  const timers: (() => void)[] = [];
  const win: Record<string, unknown> = { setTimeout: (fn: () => void) => timers.push(fn) };
  new Function("window", "document", POINTER_OVERLAY_SCRIPT)(win, fakeDocument(root));
  return { root, win, timers };
}

describe("POINTER_OVERLAY_SCRIPT", () => {
  it("installs one fixed, click-through pointer on top and exposes __demoPointer", () => {
    const { root, win } = install();
    const pointer = root.children[0]!;
    expect(pointer.style.position).toBe("fixed");
    expect(pointer.style.pointerEvents).toBe("none");
    expect(Number(pointer.style.zIndex)).toBeGreaterThanOrEqual(2147483000);
    // VS Code's workbench enforces Trusted Types: an innerHTML assignment throws there.
    expect(pointer.innerHTML).toBe("");
    const svg = pointer.children[0]!;
    expect(svg.tag).toBe("svg");
    expect(svg.ns).toBe("http://www.w3.org/2000/svg");
    expect(svg.children[0]!.tag).toBe("path");
    expect(svg.children[0]!.attrs.d).toMatch(/^M2 2 /);
    const api = win.__demoPointer as { moveTo: unknown; ripple: unknown };
    expect(typeof api.moveTo).toBe("function");
    expect(typeof api.ripple).toBe("function");
  });

  it("moveTo puts the arrow's tip at the point", () => {
    const { root, win } = install();
    (win.__demoPointer as { moveTo(x: number, y: number): void }).moveTo(120, 45);
    const style = root.children[0]!.style;
    expect(style.left).toBe("120px");
    expect(style.top).toBe("45px");
  });

  it("ripple adds a ring at the pointer and removes it afterwards", () => {
    const { root, win, timers } = install();
    const api = win.__demoPointer as { moveTo(x: number, y: number): void; ripple(): void };
    api.moveTo(10, 20);
    api.ripple();
    const ring = root.children[1]!;
    expect(ring.style.left).toBe("10px");
    expect(ring.style.top).toBe("20px");
    expect(timers.length).toBe(1);
    timers[0]!();
    expect(ring.removed).toBe(true);
  });

  it("a second realm on the same document drives the same pointer (wdio switches realms after switchFrame)", () => {
    const first = install();
    const secondWin: Record<string, unknown> = { setTimeout: () => undefined };
    new Function("window", "document", POINTER_OVERLAY_SCRIPT)(secondWin, fakeDocument(first.root));
    expect(first.root.children.filter((c) => c.tag === "div")).toHaveLength(1);
    (first.win.__demoPointer as { moveTo(x: number, y: number): void }).moveTo(100, 200);
    const api = secondWin.__demoPointer as { moveTo(x: number, y: number): void; ripple(): void };
    api.ripple();
    const ring = first.root.children[1]!;
    expect(ring.style.left).toBe("100px");
    expect(ring.style.top).toBe("200px");
    api.moveTo(5, 6);
    expect(first.root.children[0]!.style.left).toBe("5px");
  });

  it("is idempotent: a second install keeps the first pointer", () => {
    const first = install();
    new Function("window", "document", POINTER_OVERLAY_SCRIPT)(first.win, fakeDocument(first.root));
    expect(first.root.children.filter((c) => c.tag === "div")).toHaveLength(1);
  });
});
