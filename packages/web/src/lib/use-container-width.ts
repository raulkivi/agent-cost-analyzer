import { useCallback, useEffect, useRef, useState } from "react";

// The width of the element the returned ref is attached to, kept current
// with a ResizeObserver (§3.5 Layout: the panel's width, not the window's).
// Undefined until the first report, and where the host has no
// ResizeObserver; layoutFor treats that as today's wide layout.
export function useContainerWidth<T extends Element>(): [(element: T | null) => void, number | undefined] {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const observer = useRef<ResizeObserver | null>(null);

  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!element || typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.current.observe(element);
  }, []);

  useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, width];
}
