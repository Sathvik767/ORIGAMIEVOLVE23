import { ApiError } from "../api/client";

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Not authorized. Set a valid API token in the header.";
    if (error.status === 0) return error.message;
    const fieldErrors = error.problem?.errors?.map((e) => `${e.loc.at(-1)}: ${e.msg}`).join("; ");
    return fieldErrors ? `${error.message} (${fieldErrors})` : error.message;
  }
  if (error instanceof TypeError) return "API unreachable. Is the backend running on port 8000?";
  return error instanceof Error ? error.message : String(error);
}

export function ErrorMessage({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {errorText(error)}
    </p>
  );
}
