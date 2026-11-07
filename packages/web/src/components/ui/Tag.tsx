// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { HTMLAttributes } from "react";

export type TagVariant = "accent" | "accent-2" | "neutral" | "outline";

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant: TagVariant;
}

export function Tag({ variant, className, ...rest }: TagProps) {
  const classes = ["tag", `tag-${variant}`, className].filter(Boolean).join(" ");

  return <span className={classes} {...rest} />;
}
