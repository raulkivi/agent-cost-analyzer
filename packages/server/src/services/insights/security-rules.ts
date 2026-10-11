import type { FindingSeverity, ToolCallStatus, ToolKind } from "@copilot-cost-analyzer/domain";

// Phase 9.11 (docs/plans/insights-dashboard.md §4.1): rule-based security
// *signals* over normalized tool calls. Each rule is an independent
// strategy in an ordered table (open/closed: a new signal is a new row).
// Rules match on the already bounded + redacted command text and the
// call's file paths; they never execute or resolve anything.

export interface SecuritySubject {
  kind: ToolKind;
  name: string;
  command?: string; // shell command line, or a non-shell tool's argsSummary
  paths: string[];
  status: ToolCallStatus;
}

export type SecurityCategory =
  | "remote-code-execution"
  | "obfuscation"
  | "destructive-command"
  | "history-rewrite"
  | "privilege-escalation"
  | "credential-access"
  | "persistence"
  | "sensitive-file-write"
  | "data-exfiltration"
  | "network-egress"
  | "package-install"
  | "permission-denied";

export interface SecurityRule {
  id: string;
  category: SecurityCategory;
  severity: FindingSeverity;
  title: string; // what happened
  why: string; // why it is worth a look
  // The text that matched (evidence), or null.
  match(subject: SecuritySubject): string | null;
}

export interface SecurityRuleMatch {
  rule: SecurityRule;
  evidence: string;
}

// --- matching helpers -------------------------------------------------------

// A heredoc body is data for whatever reads it — `python3 - <<'EOF'` or
// `cat > notes.md <<EOF` writing a test fixture or doc that merely
// *mentions* `curl … | bash` isn't running it. Bodies fed to a shell
// (`bash <<EOF`, `sudo sh -s <<EOF`) do execute, so those are kept. An
// unterminated heredoc (the command was truncated) runs to the end.
const HEREDOC = /(?<!<)<<(?!<)-?[ \t]*(['"]?)(\w+)\1([^\n]*)(?:\n(?:[\s\S]*?\n)?[ \t]*\2[ \t]*(?=\n|$)|\n[\s\S]*$|$)/g;
const SHELL_READS_HEREDOC = /^(?:sudo\s+(?:-\S+\s+)*)?(?:ba|z|da|k)?sh(?:\s+-s?)?\s*$/;

function withoutDataHeredocs(command: string): string {
  return command.replace(HEREDOC, (match, quote: string, tag: string, rest: string, offset: number) => {
    const lineStart = command.lastIndexOf("\n", offset) + 1;
    const consumer = command.slice(lineStart, offset).split(/\||;|&&|\|\|/).pop()!.trim();
    return SHELL_READS_HEREDOC.test(consumer) ? match : `<<${quote}${tag}${quote}${rest}\n${tag}`;
  });
}

function shellCommand(subject: SecuritySubject): string | undefined {
  return subject.kind === "shell" && subject.command !== undefined ? withoutDataHeredocs(subject.command) : undefined;
}

function shellMatcher(...patterns: RegExp[]) {
  return (subject: SecuritySubject): string | null => {
    const command = shellCommand(subject);
    return command !== undefined && patterns.some((pattern) => pattern.test(command)) ? command : null;
  };
}

function firstMatching(texts: (string | undefined)[], pattern: RegExp): string | null {
  return texts.find((text): text is string => text !== undefined && pattern.test(text)) ?? null;
}

// An interpreter that executes its *stdin*: bare, or with `-s`/`-` (args
// after that go to the script). `python3 -c …`, `node -e …` or
// `python3 script.py` run their own program and only read the piped
// download as data, so they don't match.
const SHELL_INTERPRETER = String.raw`(?:sudo\s+(?:-\S+\s+)*)?(?:(?:ba|z|da|k)?sh|python[0-9.]*|perl|ruby|node)(?:\s+-s?(?=\s|$)[^|;&\n]*)?\s*(?=$|[;&|)\n])`;

const PIPE_TO_SHELL = new RegExp(String.raw`\b(?:curl|wget)\b[^|;&\n]*\|\s*${SHELL_INTERPRETER}`);
const DECODE_TO_SHELL = new RegExp(String.raw`\bbase64\s+(?:-d|-D|--decode)\b[^;&\n]*\|\s*${SHELL_INTERPRETER}`);
const EVAL_SUBSHELL = /\beval\s+["']?\$\(/;

const RM_RECURSIVE_FORCE =
  /\brm\s+(?:-[a-zA-Z]*(?:[rR][a-zA-Z]*f|f[a-zA-Z]*[rR])[a-zA-Z]*|(?:-[rR]|--recursive)\s+(?:-f|--force)|(?:-f|--force)\s+(?:-[rR]|--recursive))(?=\s|$)([^\n]*)/;
const ROOT_TARGET = /^["']?(?:\/|\/\*|~|~\/|~\/\*|\$HOME|\$HOME\/|\$HOME\/\*|\$\{HOME\})["']?$/;

function rmRecursiveForceTargets(subject: SecuritySubject): string[] | null {
  const command = shellCommand(subject);
  const match = command ? RM_RECURSIVE_FORCE.exec(command) : null;
  if (!match) {
    return null;
  }
  const rest = (match[1] ?? "").split(/[;&|]/)[0] ?? "";
  return rest.split(/\s+/).filter(Boolean);
}

function rmTargetsRoot(subject: SecuritySubject): boolean | null {
  const targets = rmRecursiveForceTargets(subject);
  return targets === null ? null : targets.some((target) => ROOT_TARGET.test(target));
}

const SECRET_PATH =
  /(?:\.ssh\/|\bid_(?:rsa|ed25519|ecdsa|dsa)\b|\.aws\/credentials|\.netrc\b|\.npmrc\b|\.pypirc\b|\.git-credentials\b|\.docker\/config\.json|\.kube\/config|(?:^|[\s/'"=])\.env(?!\.(?:example|sample|template|dist)\b)(?:\.[\w-]+)?(?=$|[\s'";|&])|\bgh\s+auth\s+token\b)/;

const PROFILE_FILE = String.raw`\S*\.(?:bashrc|zshrc|bash_profile|zprofile|profile|zshenv)\b`;
const PERSISTENCE_SHELL = [
  new RegExp(String.raw`>>?\s*${PROFILE_FILE}`),
  new RegExp(String.raw`\btee\s+(?:-a\s+)?${PROFILE_FILE}`),
  /\bcrontab\s+(?:-e\b|-(?=\s|$)|[^\s-])/,
  /\bsystemctl\s+(?:--user\s+)?enable\b/,
  /\blaunchctl\s+(?:load|bootstrap)\b/,
  /authorized_keys/,
];
const PERSISTENCE_PATH =
  /(?:^|\/)\.(?:bashrc|zshrc|bash_profile|zprofile|profile|zshenv)$|authorized_keys$|\.config\/autostart\/|\/Library\/LaunchAgents\/|\/etc\/cron/;

const SYSTEM_DIR = String.raw`\/(?:etc|usr|bin|sbin|boot|System|Library)\/`;
const SYSTEM_PATH_WRITE_SHELL = [
  new RegExp(String.raw`>>?\s*${SYSTEM_DIR}`),
  new RegExp(String.raw`\btee\s+(?:-a\s+)?${SYSTEM_DIR}`),
];
const SYSTEM_PATH = new RegExp(`^${SYSTEM_DIR}`);

function writtenPaths(subject: SecuritySubject): string[] {
  return subject.kind === "file-write" ? subject.paths : [];
}

// --- the rule table -----------------------------------------------------------

export const DEFAULT_SECURITY_RULES: readonly SecurityRule[] = [
  {
    id: "shell.pipe-to-shell",
    category: "remote-code-execution",
    severity: "critical",
    title: "Downloaded script piped straight into an interpreter",
    why: "Runs code fetched from the network without it ever being reviewed or saved.",
    match: shellMatcher(PIPE_TO_SHELL),
  },
  {
    id: "shell.decode-and-exec",
    category: "obfuscation",
    severity: "high",
    title: "Decoded or generated code executed",
    why: "Executing base64-decoded or eval'd command output hides what actually runs.",
    match: shellMatcher(DECODE_TO_SHELL, EVAL_SUBSHELL),
  },
  {
    id: "shell.rm-rf-root",
    category: "destructive-command",
    severity: "high",
    title: "Recursive force delete of the root or home directory",
    why: "rm -rf on / or ~ can wipe the whole machine or the user's home directory.",
    match: (subject) => (rmTargetsRoot(subject) === true ? (shellCommand(subject) ?? null) : null),
  },
  {
    id: "shell.rm-rf",
    category: "destructive-command",
    severity: "medium",
    title: "Recursive force delete",
    why: "rm -rf deletes without confirmation; worth checking the target was intended.",
    match: (subject) => (rmTargetsRoot(subject) === false ? (shellCommand(subject) ?? null) : null),
  },
  {
    id: "git.force-push",
    category: "history-rewrite",
    severity: "high",
    title: "Force push",
    why: "A force push overwrites remote history and can discard other people's commits.",
    match: shellMatcher(/\bgit\s+push\b[^;&|\n]*\s(?:--force(?:-with-lease)?|-f)\b/),
  },
  {
    id: "git.destructive-reset",
    category: "destructive-command",
    severity: "medium",
    title: "Uncommitted work discarded",
    why: "git reset --hard / git clean -f permanently drop uncommitted changes or untracked files.",
    match: shellMatcher(/\bgit\s+reset\b[^;&|\n]*--hard\b/, /\bgit\s+clean\s+-[a-zA-Z]*f/),
  },
  {
    id: "shell.privilege-escalation",
    category: "privilege-escalation",
    severity: "medium",
    title: "Command run with elevated privileges",
    why: "sudo/su/doas runs as root; an agent rarely needs it for project work.",
    match: shellMatcher(/(?:^|[\s;&|(])(?:sudo|doas)\s/, /\bsu\s+-/),
  },
  {
    id: "shell.chmod-permissive",
    category: "privilege-escalation",
    severity: "medium",
    title: "World-writable or setuid permissions",
    why: "chmod 777 / a+rwx / +s widen who can modify or escalate through the file.",
    match: shellMatcher(/\bchmod\s+(?:-R\s+)?(?:0?777|a\+rwx|[ugoa]*\+[rwx]*s)\b/),
  },
  {
    id: "secrets.access",
    category: "credential-access",
    severity: "high",
    title: "Credential or secret file accessed",
    why: "SSH keys, cloud/registry credentials and .env files hold secrets that could leak into the model context.",
    match: (subject) => firstMatching([shellCommand(subject), ...subject.paths], SECRET_PATH),
  },
  {
    id: "persistence.autostart",
    category: "persistence",
    severity: "high",
    title: "Startup or login configuration modified",
    why: "Shell profiles, crontab, services and authorized_keys make changes that survive the session.",
    match: (subject) =>
      shellMatcher(...PERSISTENCE_SHELL)(subject) ?? firstMatching(writtenPaths(subject), PERSISTENCE_PATH),
  },
  {
    id: "filesystem.system-path-write",
    category: "sensitive-file-write",
    severity: "high",
    title: "Write to a system directory",
    why: "Writing under /etc, /usr, /bin or /System changes the machine, not the project.",
    match: (subject) =>
      shellMatcher(...SYSTEM_PATH_WRITE_SHELL)(subject) ?? firstMatching(writtenPaths(subject), SYSTEM_PATH),
  },
  {
    id: "network.data-upload",
    category: "data-exfiltration",
    severity: "medium",
    title: "Data uploaded to a remote host",
    why: "curl/wget sending a body or file can move local data off the machine.",
    match: shellMatcher(
      /\b(?:curl|wget)\b[^|;&\n]*\s(?:-d|--data(?:-[a-z]+)?|-F|--form|-T|--upload-file|--post-file|--post-data)(?=[\s=@]|$)/,
    ),
  },
  {
    id: "network.raw-socket",
    category: "network-egress",
    severity: "medium",
    title: "Raw network socket opened",
    why: "netcat/socat/telnet open arbitrary connections or listeners, a common reverse-shell building block.",
    match: shellMatcher(/(?:^|[\s;&|(])(?:nc|ncat|netcat|socat|telnet)\s/),
  },
  {
    id: "network.remote-shell",
    category: "network-egress",
    severity: "low",
    title: "Remote host accessed",
    why: "ssh/scp/rsync reach another machine; confirm the host and the data moved were expected.",
    match: shellMatcher(/(?:^|[\s;&|(])ssh\s+\S/, /\b(?:scp|rsync|sftp)\b[^;&|\n]*\s[\w.-]*@?[\w.-]+:/),
  },
  {
    id: "package.install",
    category: "package-install",
    severity: "low",
    title: "New package installed",
    why: "Installing a named package pulls third-party code (supply-chain risk); check the name is the one intended.",
    match: shellMatcher(
      /\b(?:npm|pnpm)\s+(?:i|install|add)\b(?:\s+-\S+)*\s+[^\s-]/,
      /\byarn\s+(?:global\s+)?add\s/,
      /\bpip[0-9.]*\s+install\s/,
      /\bpython[0-9.]*\s+-m\s+pip\s+install\s/,
      /\b(?:cargo|go|gem|brew)\s+install\s/,
      /\bapt(?:-get)?\s+install\s/,
    ),
  },
  {
    id: "tool.denied",
    category: "permission-denied",
    severity: "medium",
    title: "Action blocked by the user or a policy",
    why: "The agent attempted something that was rejected; repeated denials can mean it is pushing past its brief.",
    match: (subject) => (subject.status === "denied" ? (subject.command ?? subject.paths[0] ?? subject.name) : null),
  },
];

export function matchSecurityRules(subject: SecuritySubject, rules: readonly SecurityRule[]): SecurityRuleMatch[] {
  const matches: SecurityRuleMatch[] = [];
  for (const rule of rules) {
    const evidence = rule.match(subject);
    if (evidence !== null) {
      matches.push({ rule, evidence });
    }
  }
  return matches;
}
