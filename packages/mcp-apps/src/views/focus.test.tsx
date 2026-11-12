// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render } from "@testing-library/react";
import { useLayoutEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import { useFocusOnMountIfLost } from "./focus.js";

// Layout effects of a later sibling run in the same commit as the mount,
// before the browser can deliver a key event or paint.
function Probe({ seen }: { seen: { active: Element | null } }) {
  useLayoutEffect(() => {
    seen.active = document.activeElement;
  });
  return null;
}

function Target() {
  const ref = useRef<HTMLButtonElement>(null);
  useFocusOnMountIfLost(ref);
  return (
    <button ref={ref} type="button">
      Back
    </button>
  );
}

describe("useFocusOnMountIfLost", () => {
  // A swap that removes the focused control must not leave a gap in which Enter
  // goes nowhere: a passive effect runs after paint, so focus has to land in the commit.
  it("puts focus on the control in the commit that mounts it, not after paint", () => {
    const seen: { active: Element | null } = { active: null };
    const { getByRole } = render(
      <>
        <Target />
        <Probe seen={seen} />
      </>,
    );
    expect(seen.active).toBe(getByRole("button", { name: "Back" }));
  });
});
