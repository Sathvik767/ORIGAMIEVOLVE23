import { useEffect, useState } from "react";

import { formatDate, formatRelative } from "../../lib/format";

/** Relative time ("5 minutes ago") with the full date on hover; refreshes every minute. */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return (
    <time dateTime={iso} title={formatDate(iso)} className={className}>
      {formatRelative(iso, now)}
    </time>
  );
}
