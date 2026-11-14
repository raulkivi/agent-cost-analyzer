# SPDX-FileCopyrightText: 2026 Raul Kivi
# SPDX-License-Identifier: MIT
# Template match: prints one JSON object, keyed by template name, with the best match of each
# template in a screenshot (top-left x, y, size, TM_CCOEFF_NORMED score).
#   python3 -I match.py shot.png tpl1.png [tpl2.png ...]
import json
import os
import sys

import cv2

args = sys.argv[1:]
# --min-x N: only matches whose left edge is at x >= N count (the side pane, once open).
min_x = 0
if args[:1] == ["--min-x"]:
    min_x, args = int(args[1]), args[2:]
shot = cv2.imread(args[0], cv2.IMREAD_GRAYSCALE)
if shot is None:
    sys.exit(f"cannot read screenshot {args[0]}")
out = {}
for path in args[1:]:
    tpl = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if tpl is None:
        sys.exit(f"cannot read template {path}")
    res = cv2.matchTemplate(shot, tpl, cv2.TM_CCOEFF_NORMED)
    res[:, :min_x] = -1.0
    _, score, _, (x, y) = cv2.minMaxLoc(res)
    name = os.path.splitext(os.path.basename(path))[0]
    out[name] = {"x": x, "y": y, "width": tpl.shape[1], "height": tpl.shape[0], "score": round(float(score), 3)}
print(json.dumps(out))
