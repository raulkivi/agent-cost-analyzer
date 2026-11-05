// Phase 15 step 15.2 (docs/plans/cost-by-repository-and-project.md §4.2):
// a git remote URL → the repository key, e.g. `git@github.com:Org/App.git`
// and `https://x:TOKEN@github.com/org/app` both → `github.com/org/app`.
//
// Pure, no network. The scheme, user name, password or token, and port are
// dropped before anything else, so a key can never carry a credential. The
// whole key is lower-cased: it is an identity, not a link (GitHub and Azure
// DevOps paths are case-insensitive; on a case-sensitive host two remotes
// differing only in case would merge, which an alias can't undo — accepted,
// as no real pair is known). Returns null for a local or file remote, which
// is no shared identity; the resolver then keys by the local root.

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i;
// user@host:path, without "//" (git's scp-like syntax). The host must be
// longer than one character so `C:\repo` (a Windows path) never matches.
const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s@]{2,}):(.*)$/;
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

interface Parts {
  host: string;
  path: string;
}

function splitSchemeUrl(rest: string): Parts {
  const slash = rest.indexOf("/");
  const authority = slash === -1 ? rest : rest.slice(0, slash);
  const path = slash === -1 ? "" : rest.slice(slash + 1);
  // userinfo ends at the last "@" (a password may itself contain "@").
  const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
  const host = hostAndPort.replace(/:\d*$/, "");
  return { host, path };
}

function parse(url: string): Parts | null {
  const scheme = SCHEME.exec(url);
  if (scheme) {
    return scheme[1]!.toLowerCase() === "file" ? null : splitSchemeUrl(scheme[2]!);
  }
  const scp = SCP_LIKE.exec(url);
  return scp ? { host: scp[1]!, path: scp[2]! } : null;
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function pathSegments(path: string): string[] | null {
  const segments = path
    .split("/")
    .filter((segment) => segment !== "")
    .map((segment) => decode(segment).toLowerCase());
  // An "@" in the path is userinfo in the wrong place (`user:pass@host`
  // parses as host "user", path "pass@host"); no real repository path has one.
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === ".." || segment.includes("@"))) {
    return null;
  }
  const last = segments.length - 1;
  segments[last] = segments[last]!.replace(/\.git$/, "");
  return segments[last] === "" ? null : segments;
}

// Azure DevOps writes one repository four ways; all become
// dev.azure.com/<org>/<project>/<repo>.
function azureDevOps(host: string, segments: string[]): Parts | null {
  if ((host === "ssh.dev.azure.com" || host === "vs-ssh.visualstudio.com") && segments[0] === "v3") {
    return { host: "dev.azure.com", path: segments.slice(1).join("/") };
  }
  if (host === "dev.azure.com") {
    return { host, path: segments.filter((segment) => segment !== "_git").join("/") };
  }
  const legacy = /^([a-z0-9-]+)\.visualstudio\.com$/.exec(host);
  if (legacy) {
    const rest = segments.filter((segment) => segment !== "_git");
    const withoutCollection = rest[0] === "defaultcollection" ? rest.slice(1) : rest;
    return { host: "dev.azure.com", path: [legacy[1]!, ...withoutCollection].join("/") };
  }
  return null;
}

export function normalizeRemoteUrl(url: string): string | null {
  const parts = parse(url.trim());
  if (!parts) {
    return null;
  }
  const host = parts.host.toLowerCase();
  if (!HOST.test(host)) {
    return null;
  }
  const segments = pathSegments(parts.path);
  if (!segments) {
    return null;
  }
  const normalized = azureDevOps(host, segments) ?? { host, path: segments.join("/") };
  return `${normalized.host}/${normalized.path}`;
}
