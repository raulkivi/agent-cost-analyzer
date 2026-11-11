// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
import { useCallback, useEffect, useState } from "react";
import type { AppHostPort, DisplayMode } from "../../host/app-host-port.js";

// The view's display mode and whether the host offers fullscreen (A31). The
// host context is the source of truth; a request's answer updates it at once,
// and a host may also change the mode on its own.
export function useDisplayMode(port: AppHostPort) {
  const [mode, setMode] = useState<DisplayMode>("inline");
  const [offered, setOffered] = useState<DisplayMode[]>([]);

  useEffect(
    () =>
      port.onHostContext((context) => {
        // Hosts send any subset of the context, so a missing field keeps the last value.
        if (context.displayMode !== undefined) setMode(context.displayMode);
        if (context.availableDisplayModes !== undefined) setOffered(context.availableDisplayModes);
      }),
    [port],
  );

  const toggleFullscreen = useCallback(async () => {
    setMode(await port.requestDisplayMode(mode === "fullscreen" ? "inline" : "fullscreen"));
  }, [port, mode]);

  return { mode, fullscreenOffered: offered.includes("fullscreen"), toggleFullscreen };
}
