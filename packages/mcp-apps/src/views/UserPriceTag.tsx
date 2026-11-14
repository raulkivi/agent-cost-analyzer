// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { userPriceLabel } from "../view-models/user-price.js";

// 1.0 V2b (threat-model 5.10): the label beside a priced figure, or a total
// that includes priced turns, computed with a price version the user added.
// The tool names the versions (userPriceVersionIds); billed, reported and
// bundled-priced figures have none, so they render nothing. The words carry
// the meaning, the dashed frame (theme.css) only repeats them. The ids are
// folded and capped, and rendered as text only. Simulated figures keep their
// own label.
export function UserPriceTag({ ids }: { ids?: readonly string[] | undefined }) {
  const label = userPriceLabel(ids);
  if (label === undefined) return null;
  return (
    <span className="user-price-tag" role="note" aria-label={label.name} title={`${label.name}. Not a vendor-billed amount; see the price book.`}>
      {label.text}
    </span>
  );
}
