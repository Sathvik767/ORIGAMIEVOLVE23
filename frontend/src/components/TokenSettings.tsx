import { useState, type FormEvent } from "react";

import { useToken } from "./TokenContext";

export function TokenSettings() {
  const { token, setToken } = useToken();
  const [editing, setEditing] = useState(!token);
  const [draft, setDraft] = useState("");

  function save(e: FormEvent) {
    e.preventDefault();
    setToken(draft.trim());
    setDraft("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-emerald-700">● API token set</span>
        <button type="button" className="text-slate-500 underline hover:text-slate-800" onClick={() => setEditing(true)}>
          change
        </button>
        <button type="button" className="text-slate-500 underline hover:text-slate-800" onClick={() => setToken("")}>
          clear
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="flex items-center gap-2 text-sm">
      <label htmlFor="api-token" className="text-slate-600">
        API token
      </label>
      <input
        id="api-token"
        type="password"
        autoComplete="off"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="oe_…"
        className="w-56 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
      />
      <button type="submit" disabled={!draft.trim()} className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40">
        Save
      </button>
    </form>
  );
}
