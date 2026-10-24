import { Blueprint } from "./ui/Blueprint.js";

interface AdviceExportTriggerBarProps {
  count: number;
  onExport: () => void;
}

export function AdviceExportTriggerBar({ count, onExport }: AdviceExportTriggerBarProps) {
  if (count === 0) {
    return null;
  }

  return (
    <Blueprint
      style={{
        marginTop: "var(--space-2)",
        padding: "var(--space-2) var(--space-3)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "var(--space-2)",
      }}
    >
      <span style={{ fontSize: 12 }}>
        {count} session{count === 1 ? "" : "s"} selected for advice
      </span>
      <button
        type="button"
        className="btn btn-primary"
        style={{ fontSize: 12, padding: "4px 10px", flexShrink: 0 }}
        onClick={onExport}
      >
        Export advice
      </button>
    </Blueprint>
  );
}
