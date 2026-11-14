// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT

// 1.0 V2 (threat-model 5.10): the label on a priced figure, or a total that
// includes priced turns, computed with at least one price version the user
// added (origin "user"). The server names those versions
// (userPriceVersionIds); billed, reported and bundled-priced figures have
// none, so they render nothing here. The words carry the meaning; the dashed
// frame only repeats them.
export function UserPriceTag({ ids }: { ids?: readonly string[] | undefined }) {
  if (ids === undefined || ids.length === 0) return null;
  const versions = `${ids.length === 1 ? "version" : "versions"}: ${ids.join(", ")}`;
  return (
    <span
      className="user-price-tag"
      role="note"
      aria-label={`Priced with your own price ${versions}`}
      title={`Priced with your own price ${versions}. Not a vendor-billed amount; see the price book.`}
    >
      your prices
    </span>
  );
}
