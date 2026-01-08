import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

type DownloadResponse = { jobId: string };

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export function DownloadModelById({
  downloadUrl,
  clientId,
  disabled,
  onQueued,
  onError,
}: {
  downloadUrl: URL;
  clientId: string;
  disabled: boolean;
  onQueued: (args: { jobId: string; modelVersionId: number }) => void;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsed = useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return { ok: false as const, modelVersionId: 0 };
    const num = Number(trimmed);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num <= 0) return { ok: false as const, modelVersionId: 0 };
    return { ok: true as const, modelVersionId: num };
  }, [value]);

  const submit = async () => {
    if (!parsed.ok) {
      onError("Enter a valid Civitai model version ID (a positive integer).");
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetchJson<DownloadResponse>(downloadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, modelVersionId: parsed.modelVersionId }),
      });
      onQueued({ jobId: resp.jobId, modelVersionId: parsed.modelVersionId });
      setValue("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-medium">Download by ID</div>
        <p className="text-xs text-muted-foreground">
          Paste a Civitai <span className="font-mono">modelVersionId</span> to download. Progress updates stream over WebSocket.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 135867"
          inputMode="numeric"
          pattern="[0-9]*"
          disabled={disabled || submitting}
        />
        <Button
          type="button"
          onClick={submit}
          disabled={disabled || submitting || !parsed.ok || !clientId}
          className="sm:w-44"
        >
          {submitting ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          Start download
        </Button>
      </div>
    </div>
  );
}

