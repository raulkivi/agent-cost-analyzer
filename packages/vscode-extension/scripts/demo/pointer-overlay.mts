// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// The drawn demo pointer, as browser-side source. Framework-free: Playwright
// passes it to `page.addInitScript`, wdio to `browser.execute`. The caller
// moves it by stepping through `glidePath` points (pointer-target.mts) and
// calls ripple() on each click.

// An IIFE over the globals `window` and `document`, so a fake pair can run it in unit tests.
export const POINTER_OVERLAY_SCRIPT = `(function () {
  if (window.__demoPointer) return;
  var ID = "__demo-pointer";
  var arrow =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
    '<path d="M2 2 L2 19 L6.5 14.8 L9.6 21.6 L12.4 20.4 L9.3 13.6 L15.5 13.4 Z" ' +
    'fill="#ffffff" stroke="#1b1b1f" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  var pointer = document.createElement("div");
  pointer.id = ID;
  pointer.innerHTML = arrow;
  var s = pointer.style;
  s.position = "fixed";
  s.left = "0px";
  s.top = "0px";
  s.width = "24px";
  s.height = "24px";
  s.pointerEvents = "none";
  s.zIndex = "2147483647";
  s.filter = "drop-shadow(0 1px 2px rgba(0,0,0,0.45))";
  document.documentElement.appendChild(pointer);
  var x = 0;
  var y = 0;
  window.__demoPointer = {
    moveTo: function (nx, ny) {
      x = nx;
      y = ny;
      pointer.style.left = nx + "px";
      pointer.style.top = ny + "px";
    },
    ripple: function () {
      var ring = document.createElement("div");
      var r = ring.style;
      r.position = "fixed";
      r.left = x + "px";
      r.top = y + "px";
      r.width = "36px";
      r.height = "36px";
      r.marginLeft = "-18px";
      r.marginTop = "-18px";
      r.borderRadius = "50%";
      r.border = "3px solid rgba(255,255,255,0.9)";
      r.boxShadow = "0 0 0 1px rgba(27,27,31,0.6)";
      r.pointerEvents = "none";
      r.zIndex = "2147483646";
      document.documentElement.appendChild(ring);
      if (typeof ring.animate === "function") {
        ring.animate(
          [{ transform: "scale(0.3)", opacity: 1 }, { transform: "scale(1.4)", opacity: 0 }],
          { duration: 450, easing: "ease-out" },
        );
      }
      window.setTimeout(function () { ring.remove(); }, 450);
    },
  };
})();`;
