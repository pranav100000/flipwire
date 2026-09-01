import type { Source } from "@/connectors/contracts";

const labels: Readonly<Record<Source, string>> = {
  b2b: "B2B",
  ticket_data: "Ticket Data",
  tickpick: "TickPick",
};

export const SourceBadge = ({ source }: Readonly<{ source: Source }>) => (
  <span className={`source-badge source-${source}`}>{labels[source]}</span>
);
