// What the UI says where VS Code Agent Host sessions lack data the classic
// Copilot store records (step 10.13; 10.14 reads it from the Copilot CLI's
// event log). Shown by Session.copilotHarness === "agent-host".

export const AGENT_HOST_TURN_INSPECTOR_UNAVAILABLE = {
  title: "Not available yet",
  body: "The request and response text of Agent Host sessions aren't read yet, so this turn can't be inspected. Its tokens and AI Credits are in the turns table.",
};

export const AGENT_HOST_SYSTEM_PROMPT_UNAVAILABLE =
  "The system prompt of Agent Host sessions isn't read yet, so no breakdown is available.";

export const AGENT_HOST_TOOL_INVENTORY_UNAVAILABLE = "The tool inventory of Agent Host sessions isn't read yet.";

export const AGENT_HOST_TURN_TOOL_CALLS_UNAVAILABLE = "Tool calls of Agent Host sessions aren't read yet.";

export const AGENT_HOST_AUDIT_UNAVAILABLE = {
  title: "Tool calls not available yet",
  body: "Tool calls of Agent Host sessions aren't read yet, so there is nothing to audit here. That doesn't mean the agent ran no tools.",
};
