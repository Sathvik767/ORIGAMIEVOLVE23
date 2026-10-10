const STYLES: Record<string, string> = {
  uploaded: "bg-slate-100 text-slate-700",
  queued: "bg-slate-100 text-slate-700",
  ingesting: "bg-sky-100 text-sky-800",
  running: "bg-sky-100 text-sky-800",
  ready: "bg-emerald-100 text-emerald-800",
  completed: "bg-emerald-100 text-emerald-800",
  ready_with_errors: "bg-amber-100 text-amber-900",
  partially_failed: "bg-amber-100 text-amber-900",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-slate-200 text-slate-600",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[status] ?? STYLES.uploaded}`}>
      {status.replaceAll("_", " ")}
    </span>
  );
}
