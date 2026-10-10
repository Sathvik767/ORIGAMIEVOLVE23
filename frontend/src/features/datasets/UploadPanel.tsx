import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { inferFormat, uploadDataset, type DesignFormat, type UploadResult } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { formatBytes } from "../../lib/format";

type State =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number; abort: () => void }
  | { kind: "done"; result: UploadResult }
  | { kind: "error"; error: unknown };

export function UploadPanel() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<DesignFormat | "">("");
  const [state, setState] = useState<State>({ kind: "idle" });

  function pick(selected: File | null) {
    setFile(selected);
    setState({ kind: "idle" });
    if (selected) {
      setName((current) => current || selected.name.replace(/\.[^.]+$/, ""));
      setFormat(inferFormat(selected.name) ?? "");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !format || !name.trim()) return;
    const { promise, abort } = uploadDataset(file, { name: name.trim(), format }, (progress) =>
      setState({ kind: "uploading", progress, abort }),
    );
    setState({ kind: "uploading", progress: 0, abort });
    try {
      const result = await promise;
      setState({ kind: "done", result });
      setFile(null);
      setName("");
      setFormat("");
      if (fileInput.current) fileInput.current.value = "";
      void queryClient.invalidateQueries({ queryKey: ["datasets"] });
    } catch (error) {
      setState({ kind: "error", error });
    }
  }

  const uploading = state.kind === "uploading";
  return (
    <section aria-labelledby="upload-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 id="upload-heading" className="mb-1 text-lg font-semibold text-slate-800">
        Upload dataset
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        CSV (one row per strand), NDJSON (one design per line) or a JSON array. See{" "}
        <code className="text-xs">docs/input-formats.md</code>.
      </p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">File</span>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.ndjson,.jsonl,.json"
            disabled={uploading}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Name</span>
          <input
            value={name}
            maxLength={200}
            disabled={uploading}
            onChange={(e) => setName(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600">Format</span>
          <select
            value={format}
            disabled={uploading}
            onChange={(e) => setFormat(e.target.value as DesignFormat | "")}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="">choose…</option>
            <option value="csv">CSV</option>
            <option value="ndjson">NDJSON</option>
            <option value="json">JSON array</option>
          </select>
        </label>
        {uploading ? (
          <button type="button" onClick={state.abort} className="rounded border border-slate-300 px-4 py-1.5 text-sm">
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={!file || !format || !name.trim()}
            className="rounded bg-slate-800 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Upload
          </button>
        )}
      </form>

      {file && !uploading && <p className="mt-2 text-xs text-slate-500">{formatBytes(file.size)}</p>}
      {uploading && (
        <div className="mt-3" aria-live="polite">
          <progress className="h-2 w-full" value={state.progress} max={1} aria-label="Upload progress" />
          <p className="text-xs text-slate-500">Uploading… {Math.round(state.progress * 100)}%</p>
        </div>
      )}
      {state.kind === "done" && (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          {state.result.duplicate ? "This file was already uploaded: " : "Uploaded. Validation is running: "}
          <Link to={`/datasets/${state.result.dataset.id}`} className="underline">
            {state.result.dataset.name}
          </Link>
        </p>
      )}
      {state.kind === "error" && (
        <div className="mt-3">
          <ErrorMessage error={state.error} />
        </div>
      )}
    </section>
  );
}
