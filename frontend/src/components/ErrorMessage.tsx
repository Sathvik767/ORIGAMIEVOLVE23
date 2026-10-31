import { CircleAlert, RotateCw } from "lucide-react";

import { ApiError } from "../api/client";
import { Button } from "./ui/Button";

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Not authorized. Set a valid API token in the sidebar.";
    if (error.status === 0) return error.message;
    const fieldErrors = error.problem?.errors?.map((e) => `${e.loc.at(-1)}: ${e.msg}`).join("; ");
    return fieldErrors ? `${error.message} (${fieldErrors})` : error.message;
  }
  if (error instanceof TypeError) return "API unreachable. Is the backend running on port 8000?";
  return error instanceof Error ? error.message : String(error);
}

/** Error alert with an icon and, when the failed query can be repeated, a Retry button. */
export function ErrorMessage({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-fg">
      <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 break-words">{errorText(error)}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" icon={<RotateCw aria-hidden className="size-3.5" />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
