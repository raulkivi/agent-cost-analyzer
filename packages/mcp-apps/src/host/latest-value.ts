// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import type { Unsubscribe } from "./app-host-port.js";

// A subscribable that replays its latest value to new listeners: the host
// may deliver context or a tool result before the view has subscribed.
export class LatestValue<T> {
  private latest: { value: T } | undefined;
  private readonly listeners = new Set<(value: T) => void>();

  publish(value: T): void {
    this.latest = { value };
    for (const listener of [...this.listeners]) listener(value);
  }

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    if (this.latest) listener(this.latest.value);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
