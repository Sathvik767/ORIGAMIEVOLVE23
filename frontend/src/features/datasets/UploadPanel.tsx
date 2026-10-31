import { useQueryClient } from "@tanstack/react-query";
import { CircleCheck, FileUp, UploadCloud, X } from "lucide-react";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link } from "react-router";

import { inferFormat, uploadDataset, type DesignFormat, type UploadResult } from "../../api/client";
import { ErrorMessage } from "../../components/ErrorMessage";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ProgressBar } from "../../components/ui/Feedback";
import { Field, Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { cx } from "../../lib/cx";
import { formatBytes } from "../../lib/format";

type State =
  | { kind: "idle" }
  | { kind: "uploading"; progress: number; abort: () => void }
  | { kind: "done"; result: UploadResult }
  | { kind: "error"; error: unknown };

export function UploadPanel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [format, setFormat] = useState<DesignFormat | "">("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  function pick(selected: File | null) {
    setFile(selected);
    setState({ kind: "idle" });
    if (selected) {
      setName((current) => current || selected.name.replace(/\.[^.]+$/, ""));
      setFormat(inferFormat(selected.name) ?? "");
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    pick(e.dataTransfer.files?.[0] ?? null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !format || !name.trim()) return;
    const { promise, abort } = uploadDataset(file, { name: name.trim(), format }, (progress) =>
      setState({ kind: "uploading", progress, abort }),
    );
    setState({ kind: "uploading", progress: 0, abort });
    toast(`Uploading “${file.name}”…`, "info");
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
    <Card
      title="Upload dataset"
      icon={<UploadCloud className="size-4" />}
      description={
        <>
          CSV (one row per strand), NDJSON (one design per line) or a JSON array. See{" "}
          <code className="font-mono text-xs">docs/input-formats.md</code>.
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cx(
            "relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors duration-150",
            dragging ? "border-primary bg-primary-soft" : "border-border bg-surface-sunken/60 hover:border-border-strong",
            uploading && "opacity-60",
          )}
        >
          {file ? (
            <>
              <FileUp aria-hidden className="size-7 text-primary" />
              <p className="font-mono text-sm break-all text-fg">{file.name}</p>
              <p className="text-xs text-muted">
                {formatBytes(file.size)}
                {format ? ` · detected ${format.toUpperCase()}` : " · format not recognised, choose it below"}
              </p>
              {!uploading && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<X aria-hidden className="size-3.5" />}
                  onClick={() => {
                    pick(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  Remove file
                </Button>
              )}
            </>
          ) : (
            <>
              <UploadCloud aria-hidden className="size-7 text-subtle" />
              <p className="text-sm text-fg">
                Drag a file here, or{" "}
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className="font-medium text-primary underline-offset-2 hover:underline"
                >
                  browse
                </button>
              </p>
              <p className="text-xs text-muted">.csv, .ndjson, .jsonl or .json</p>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            aria-label="File"
            accept=".csv,.ndjson,.jsonl,.json"
            disabled={uploading}
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="sr-only"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
          <Field label="Name">
            <Input value={name} maxLength={200} disabled={uploading} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Format">
            <Select value={format} disabled={uploading} onChange={(e) => setFormat(e.target.value as DesignFormat | "")}>
              <option value="">choose…</option>
              <option value="csv">CSV</option>
              <option value="ndjson">NDJSON</option>
              <option value="json">JSON array</option>
            </Select>
          </Field>
          {uploading ? (
            <Button onClick={state.abort}>Cancel</Button>
          ) : (
            <Button type="submit" variant="primary" icon={<UploadCloud aria-hidden className="size-4" />} disabled={!file || !format || !name.trim()}>
              Upload
            </Button>
          )}
        </div>
      </form>

      {uploading && (
        <div className="mt-4 space-y-1.5" aria-live="polite">
          <ProgressBar value={state.progress} max={1} label="Upload progress" />
          <p className="font-mono text-xs text-muted">Uploading… {Math.round(state.progress * 100)}%</p>
        </div>
      )}
      {state.kind === "done" && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-success">
          <CircleCheck aria-hidden className="size-4 shrink-0" />
          <span className="text-fg">
            {state.result.duplicate ? "This file was already uploaded: " : "Uploaded. Validation is running: "}
            <Link to={`/datasets/${state.result.dataset.id}`} className="font-medium text-primary underline">
              {state.result.dataset.name}
            </Link>
          </span>
        </p>
      )}
      {state.kind === "error" && (
        <div className="mt-4">
          <ErrorMessage error={state.error} />
        </div>
      )}
    </Card>
  );
}
