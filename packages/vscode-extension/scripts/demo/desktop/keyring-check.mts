// SPDX-FileCopyrightText: 2026 Raul Kivi
// SPDX-License-Identifier: MIT
// Claude Desktop keeps its sign-in encrypted with a key from the desktop keyring (the D-Bus secret service). Started
// without the keyring, it cannot read the sign-in, starts signed out and drops the profile's sign-in on exit, so the
// owner has to sign in again. The recorder checks the keyring first and stops before it launches Desktop.
export type Exec = (file: string, args: string[]) => string;

const NAME_HAS_OWNER = [
  "--session",
  "--print-reply",
  "--reply-timeout=3000",
  "--dest=org.freedesktop.DBus",
  "/org/freedesktop/DBus",
  "org.freedesktop.DBus.NameHasOwner",
  "string:org.freedesktop.secrets",
];

export function secretServiceReachable(exec: Exec): boolean {
  try {
    return /boolean true/.test(exec("dbus-send", NAME_HAS_OWNER));
  } catch {
    return false;
  }
}

// A session bus address with a stale guid (a shell started before the user's bus restarted) gets no reply; the plain
// socket path does.
export function keyringUnreachableMessage(busAddress: string | undefined, runtimeDir: string | undefined): string {
  const socket = `unix:path=${runtimeDir ?? "$XDG_RUNTIME_DIR"}/bus`;
  return (
    `The desktop keyring (D-Bus secret service) is not reachable on DBUS_SESSION_BUS_ADDRESS=${busAddress ?? "(unset)"}. ` +
    "Claude Desktop would start signed out and drop the demo profile's sign-in. " +
    `Retry with DBUS_SESSION_BUS_ADDRESS=${socket}, or start the keyring.`
  );
}
