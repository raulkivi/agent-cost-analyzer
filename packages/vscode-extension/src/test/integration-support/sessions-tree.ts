import type { SessionNode, SessionsTreeNode } from "../../sidebar/sessions-tree-model.js";

// Every session row of the Sessions view, as its tree data provider shows
// them: the children of each day group, in order.
export function sessionNodesOf(tree: readonly SessionsTreeNode[]): SessionNode[] {
  return tree.flatMap((node) => (node.kind === "group" ? node.children : []));
}
