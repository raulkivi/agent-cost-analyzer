# SPDX-FileCopyrightText: 2026 Raul Kivi
# SPDX-License-Identifier: MIT
# Uniqueness check for a template: how many separate places in a screenshot score at least the threshold.
#   python3 -I peaks.py shot.png template.png [threshold]
# Prints {"peaks": n, "best": score}. A template used to click or wait must give exactly 1 on the screen it is used on.
import json
import sys

import cv2
import numpy as np

shot = cv2.imread(sys.argv[1], cv2.IMREAD_GRAYSCALE)
tpl = cv2.imread(sys.argv[2], cv2.IMREAD_GRAYSCALE)
threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.9
if shot is None or tpl is None:
    sys.exit("cannot read an image")
res = cv2.matchTemplate(shot, tpl, cv2.TM_CCOEFF_NORMED)
peaks = []
for y, x in zip(*np.where(res >= threshold)):
    # Neighbouring pixels of one hit are the same place.
    if not any(abs(x - px) < tpl.shape[1] and abs(y - py) < tpl.shape[0] for px, py in peaks):
        peaks.append((x, y))
print(json.dumps({"peaks": len(peaks), "best": round(float(res.max()), 3)}))
