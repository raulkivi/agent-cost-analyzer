// A zod error's issues as one line for a 400 message: "field: problem; …".
export function describeIssues(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}
