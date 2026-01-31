"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";

type ModelsResponse = { modelPaths: string[] };
type SetLlmModelResponse = { modelPath: string };

type LlmModelOption = {
  id: string; // relative to the Python service's LLM_MODEL_DIR (e.g. "gpt-oss-120b" or ".")
  label: string;
};

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}

function llmModelIdFromAnyPath(value: string): string | null {
  const normalized = normalizePath(value);

  const llmMarker = "/llm/";
  const idx = normalized.toLowerCase().indexOf(llmMarker);
  if (idx === -1) {
    if (normalized.toLowerCase().endsWith("/llm")) return ".";
    return null;
  }

  const rest = normalized.slice(idx + llmMarker.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 0) return ".";

  const first = parts[0] ?? "";
  if (!first) return ".";

  const firstLower = first.toLowerCase();
  if (firstLower === "original" || firstLower === "metal" || firstLower.startsWith(".")) return ".";
  if (firstLower.endsWith(".safetensors")) return ".";
  return first;
}

function labelForModelId(id: string): string {
  if (!id || id === ".") return "llm (root)";
  return id;
}

export function LlmModelPicker({
  apiBaseUrl,
  value,
  onChange,
  onErrorChange,
  disabled,
}: {
  apiBaseUrl: string;
  value: string;
  onChange: (next: string) => void;
  onErrorChange?: (next: string) => void;
  disabled?: boolean;
}) {
  const modelsUrl = useMemo(() => new URL("models", apiBaseUrl), [apiBaseUrl]);
  const setLlmModelUrl = useMemo(() => new URL("setllmmodel", apiBaseUrl), [apiBaseUrl]);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | "refresh" | "apply">(null);
  const [options, setOptions] = useState<LlmModelOption[]>([]);

  const currentLabel = useMemo(() => labelForModelId(value), [value]);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    onErrorChange?.("");
    try {
      const resp = await fetchJson<ModelsResponse>(modelsUrl);
      const uniq = new Map<string, LlmModelOption>();
      for (const fullPath of resp.modelPaths ?? []) {
        const id = llmModelIdFromAnyPath(fullPath);
        if (!id) continue;
        uniq.set(id, { id, label: labelForModelId(id) });
      }
      setOptions([...uniq.values()].sort((a, b) => a.label.localeCompare(b.label)));
    } catch (err) {
      onErrorChange?.(err instanceof Error ? err.message : "Failed to load LLM models.");
    } finally {
      setBusy(null);
    }
  }, [modelsUrl, onErrorChange]);

  const apply = useCallback(
    async (id: string) => {
      if (!id) return;
      setBusy("apply");
      onErrorChange?.("");
      try {
        const resp = await fetchJson<SetLlmModelResponse>(setLlmModelUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelPath: id }),
        });

        const resolvedId = llmModelIdFromAnyPath(resp.modelPath ?? "") ?? id;
        onChange(resolvedId);
      } catch (err) {
        onErrorChange?.(err instanceof Error ? err.message : "Failed to set LLM model.");
      } finally {
        setBusy(null);
      }
    },
    [onChange, onErrorChange, setLlmModelUrl]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isDisabled = disabled || busy !== null || options.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          role="combobox"
          aria-expanded={open}
          disabled={isDisabled}
          className="gap-2"
          title={value || ""}
        >
          {value ? `LLM: ${currentLabel}` : "Select LLM model..."}
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ChevronsUpDown className="opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-0">
        <Command>
          <CommandInput placeholder="Search LLM models..." />
          <CommandEmpty>No LLM models found under /llm.</CommandEmpty>
          <CommandList>
            <CommandGroup heading="LLM models">
              {options.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={opt.label}
                  onSelect={() => {
                    setOpen(false);
                    void apply(opt.id);
                  }}
                >
                  <Check className={value === opt.id ? "mr-2 size-4 opacity-100" : "mr-2 size-4 opacity-0"} />
                  <span className="truncate">{opt.label}</span>
                  {value === opt.id ? (
                    <Badge variant="secondary" className="ml-auto">
                      Selected
                    </Badge>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

