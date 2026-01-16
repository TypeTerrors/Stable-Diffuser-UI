"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, Check, ChevronsUpDown, Loader2, RefreshCw, Trash2 } from "lucide-react";

type ModelsResponse = { modelPaths: string[] };
type CurrentModelResponse = { modelPath: string };

type CatalogItem = {
  fullPath: string;
  group: string;
  name: string;
};

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").slice(-1)[0] ?? path;
}

function buildCatalog(paths: string[]): CatalogItem[] {
  return paths
    .filter(Boolean)
    .map((fullPath) => {
      const normalized = fullPath.replaceAll("\\", "/");
      const token = "/models/";
      const rel = normalized.includes(token) ? normalized.split(token)[1] : normalized.split("/").slice(-2).join("/");
      const parts = rel.split("/").filter(Boolean);
      const group = parts[0] ?? "root";
      const name = parts[parts.length - 1] ?? rel;
      return { fullPath, group, name };
    })
    .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export function I2VSetModelCard({
  baseUrl,
  onModelChanged,
}: {
  baseUrl: string;
  onModelChanged: (modelPath: string) => void;
}) {
  const urls = useMemo(() => {
    return {
      models: new URL("models", baseUrl),
      currentModel: new URL("currentmodel", baseUrl),
      setModel: new URL("setmodel", baseUrl),
      clearModel: new URL("clearmodel", baseUrl),
    };
  }, [baseUrl]);

  const [availableModelPaths, setAvailableModelPaths] = useState<string[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState("");
  const [currentModelPath, setCurrentModelPath] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<null | "refresh" | "setModel" | "clearModel">(null);
  const [status, setStatus] = useState("");

  const catalog = useMemo(() => buildCatalog(availableModelPaths), [availableModelPaths]);
  const groups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of catalog) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return map;
  }, [catalog]);

  const selectedModelLabel = selectedModelPath ? basename(selectedModelPath) : "";
  const currentModelLabel = currentModelPath ? basename(currentModelPath) : "";

  const refresh = async () => {
    setBusy("refresh");
    setStatus("");
    try {
      const [models, currentModel] = await Promise.all([
        fetchJson<ModelsResponse>(urls.models),
        fetchJson<CurrentModelResponse>(urls.currentModel),
      ]);
      setAvailableModelPaths(models.modelPaths ?? []);
      setCurrentModelPath(currentModel.modelPath ?? "");
      onModelChanged(currentModel.modelPath ?? "");
      if (!selectedModelPath && currentModel.modelPath) setSelectedModelPath(currentModel.modelPath);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyModel = async () => {
    if (!selectedModelPath) return;
    setBusy("setModel");
    setStatus("");
    try {
      const resp = await fetchJson<CurrentModelResponse>(urls.setModel, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelPath: selectedModelPath, modelType: "i2v" }),
      });
      setCurrentModelPath(resp.modelPath ?? "");
      onModelChanged(resp.modelPath ?? "");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const clearModel = async () => {
    setBusy("clearModel");
    setStatus("");
    try {
      await fetchJson<{ modelPath: string }>(urls.clearModel, { method: "POST" });
      setCurrentModelPath("");
      onModelChanged("");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader className="space-y-2">
        <CardTitle>Model</CardTitle>
        <CardDescription>Set the active LTX i2v checkpoint before generating.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
            {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
          </Badge>
          <Button variant="outline" size="sm" onClick={refresh} disabled={busy !== null} className="gap-2">
            {busy === "refresh" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh
          </Button>
          <Button variant="ghost" size="sm" onClick={clearModel} disabled={busy !== null || !currentModelPath} className="gap-2">
            <Trash2 className="size-4" />
            Clear
          </Button>
        </div>

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" role="combobox" aria-expanded={pickerOpen} className="w-full justify-between" disabled={busy !== null}>
              {selectedModelPath ? selectedModelLabel : "Choose an i2v model..."}
              <ChevronsUpDown className="opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
            <Command>
              <CommandInput placeholder="Search models..." />
              <CommandEmpty>No models found.</CommandEmpty>
              <CommandList>
                {[...groups.entries()].map(([group, items]) => (
                  <CommandGroup key={group} heading={group}>
                    {items.map((item) => (
                      <CommandItem
                        key={item.fullPath}
                        value={`${group}/${item.name}`}
                        onSelect={() => {
                          setSelectedModelPath(item.fullPath);
                          setPickerOpen(false);
                        }}
                      >
                        <Check className={selectedModelPath === item.fullPath ? "mr-2 size-4 opacity-100" : "mr-2 size-4 opacity-0"} />
                        <span className="truncate">{item.name}</span>
                        {currentModelPath === item.fullPath ? (
                          <Badge variant="secondary" className="ml-auto">
                            Applied
                          </Badge>
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button onClick={applyModel} disabled={!selectedModelPath || busy !== null}>
          {busy === "setModel" ? <Loader2 className="animate-spin" /> : null}
          Set model
        </Button>

        {status ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Request failed</AlertTitle>
            <AlertDescription>{status}</AlertDescription>
          </Alert>
        ) : null}
      </CardFooter>
    </Card>
  );
}

