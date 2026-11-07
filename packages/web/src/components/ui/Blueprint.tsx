// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { HTMLAttributes } from "react";

type BlueprintProps = HTMLAttributes<HTMLDivElement>;

export function Blueprint({ className, children, ...rest }: BlueprintProps) {
  const classes = ["blueprint", className].filter(Boolean).join(" ");

  return (
    <div className={classes} {...rest}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      {children}
    </div>
  );
}
