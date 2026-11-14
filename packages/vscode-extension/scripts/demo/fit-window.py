# SPDX-FileCopyrightText: 2026 Raul Kivi
# SPDX-License-Identifier: MIT
# Resizes every mapped top-level window on $DISPLAY to WIDTH x HEIGHT at 0,0 and
# prints how many. Under Xvfb there is no window manager, so VS Code opens a
# fixed 1200x800 (or 1440x900) window it never grows; any X client may resize it.
#   python3 fit-window.py 1600 1000
import ctypes, sys
x = ctypes.cdll.LoadLibrary("libX11.so.6")
x.XOpenDisplay.restype = ctypes.c_void_p
x.XDefaultRootWindow.restype = ctypes.c_ulong
x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)), ctypes.POINTER(ctypes.c_uint)]
x.XMoveResizeWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint]
class Attr(ctypes.Structure):
    _fields_ = [("x", ctypes.c_int), ("y", ctypes.c_int), ("width", ctypes.c_int), ("height", ctypes.c_int), ("border_width", ctypes.c_int), ("depth", ctypes.c_int), ("visual", ctypes.c_void_p), ("root", ctypes.c_ulong), ("class_", ctypes.c_int), ("bit_gravity", ctypes.c_int), ("win_gravity", ctypes.c_int), ("backing_store", ctypes.c_int), ("backing_planes", ctypes.c_ulong), ("backing_pixel", ctypes.c_ulong), ("save_under", ctypes.c_int), ("colormap", ctypes.c_ulong), ("map_installed", ctypes.c_int), ("map_state", ctypes.c_int), ("all_event_masks", ctypes.c_long), ("your_event_mask", ctypes.c_long), ("do_not_propagate_mask", ctypes.c_long), ("override_redirect", ctypes.c_int), ("screen", ctypes.c_void_p)]
x.XFlush.argtypes = [ctypes.c_void_p]
x.XCloseDisplay.argtypes = [ctypes.c_void_p]
x.XGetWindowAttributes.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Attr)]
w, h = int(sys.argv[1]), int(sys.argv[2])
d = x.XOpenDisplay(None)
if not d: sys.exit("no display")
root = x.XDefaultRootWindow(d)
r, p, kids, n = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
x.XQueryTree(d, root, ctypes.byref(r), ctypes.byref(p), ctypes.byref(kids), ctypes.byref(n))
count = 0
for i in range(n.value):
    a = Attr(); x.XGetWindowAttributes(d, kids[i], ctypes.byref(a))
    if a.map_state == 2 and not a.override_redirect and a.width > 200:
        x.XMoveResizeWindow(d, kids[i], 0, 0, w, h); count += 1
x.XFlush(d); x.XCloseDisplay(d)
print(count)
