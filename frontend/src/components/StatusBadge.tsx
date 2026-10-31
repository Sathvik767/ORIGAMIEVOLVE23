import { Ban, CircleCheck, CircleDashed, CircleX, Clock, LoaderCircle, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { Badge, type Tone } from "./ui/Badge";

const STYLES: Record<string, { tone: Tone; icon: ReactNode }> = {
  uploaded: { tone: "neutral", icon: <CircleDashed aria-hidden className="size-3" /> },
  queued: { tone: "neutral", icon: <Clock aria-hidden className="size-3" /> },
  ingesting: { tone: "info", icon: <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> },
  running: { tone: "info", icon: <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> },
  validating: { tone: "info", icon: <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> },
  converting: { tone: "info", icon: <LoaderCircle aria-hidden className="size-3 motion-safe:animate-spin" /> },
  ready: { tone: "success", icon: <CircleCheck aria-hidden className="size-3" /> },
  completed: { tone: "success", icon: <CircleCheck aria-hidden className="size-3" /> },
  topology_only: { tone: "info", icon: <CircleDashed aria-hidden className="size-3" /> },
  ready_with_errors: { tone: "warning", icon: <TriangleAlert aria-hidden className="size-3" /> },
  partially_failed: { tone: "warning", icon: <TriangleAlert aria-hidden className="size-3" /> },
  awaiting_configuration: { tone: "warning", icon: <Clock aria-hidden className="size-3" /> },
  failed: { tone: "danger", icon: <CircleX aria-hidden className="size-3" /> },
  invalid: { tone: "danger", icon: <CircleX aria-hidden className="size-3" /> },
  cancelled: { tone: "neutral", icon: <Ban aria-hidden className="size-3" /> },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? STYLES.uploaded!;
  return (
    <Badge tone={style.tone} icon={style.icon}>
      {status.replaceAll("_", " ")}
    </Badge>
  );
}
