// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Tag } from "./Tag.js";

describe("Tag", () => {
  it.each([
    ["accent", "tag-accent"],
    ["accent-2", "tag-accent-2"],
    ["neutral", "tag-neutral"],
    ["outline", "tag-outline"],
  ] as const)("renders the %s variant with class %s", (variant, expectedClass) => {
    render(<Tag variant={variant}>label</Tag>);

    const tag = screen.getByText("label");
    expect(tag).toHaveClass("tag", expectedClass);
  });
});
