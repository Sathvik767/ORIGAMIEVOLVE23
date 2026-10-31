import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";

import { useToken } from "./TokenContext";
import { Button } from "./ui/Button";
import { Input } from "./ui/Field";

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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-success">
          <KeyRound aria-hidden className="size-3.5" />
          API token set
        </span>
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditing(true)}>
            change
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setToken("")}>
            clear
          </Button>
        </span>
      </div>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-2 text-sm">
      <label htmlFor="api-token" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted">
        <KeyRound aria-hidden className="size-3.5" />
        API token
      </label>
      <div className="flex gap-2">
        <Input
          id="api-token"
          type="password"
          autoComplete="off"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="oe_…"
          className="h-8 min-w-0 font-mono text-xs"
        />
        <Button type="submit" size="sm" variant="primary" disabled={!draft.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}
