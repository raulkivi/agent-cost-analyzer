// threat-model.md §5.1: the API has no authentication because it is reachable
// only from this machine (architecture.md §11.2). The Host-header guard
// (loopback-host-guard.ts) doesn't enforce that: a client on the LAN can send
// `Host: localhost:3001` itself. So the bind address is checked before the
// server listens, and a change to 0.0.0.0 fails at start instead of quietly
// turning the app into an unauthenticated network service.
const LOOPBACK_BIND_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function assertLoopbackBindHost(host: string): void {
  if (!LOOPBACK_BIND_HOSTS.has(host)) {
    throw new Error(
      `Refusing to listen on "${host}": the server must bind to a loopback address (127.0.0.1, ::1 or localhost) only. It has no authentication (architecture.md §11.2).`,
    );
  }
}
