"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AlertCircle, Check, ChevronsUpDown, Loader2, RefreshCw, Trash2, X } from "lucide-react";

type ModelsResponse = { modelPaths: string[] };
type LorasResponse = { lorapaths: string[] };
type SetLora = { path: string; weight: number };
type CurrentModelResponse = { modelPath: string };

type CatalogItem = {
  fullPath: string;
  group: string;
  name: string;
  subpath: string;
};

function buildCatalog(paths: string[], marker: "models" | "loras"): CatalogItem[] {
  return paths
    .filter(Boolean)
    .map((fullPath) => {
      const normalized = fullPath.replaceAll("\\", "/");
      const token = `/${marker}/`;
      const rel = normalized.includes(token) ? normalized.split(token)[1] : normalized.split("/").slice(-2).join("/");
      const parts = rel.split("/").filter(Boolean);
      const group = parts[0] ?? "root";
      const name = parts[parts.length - 1] ?? rel;
      const subpath = parts.slice(1, -1).join("/");
      return { fullPath, group, name, subpath };
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

export default function Home() {
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [previewSrc, setPreviewSrc] = useState("/file.svg");

  const [availableModelPaths, setAvailableModelPaths] = useState<string[]>([]);
  const [availableLoraPaths, setAvailableLoraPaths] = useState<string[]>([]);

  const [selectedModelPath, setSelectedModelPath] = useState<string>("");
  const [selectedLoras, setSelectedLoras] = useState<Record<string, number>>({});

  const [currentModelPath, setCurrentModelPath] = useState<string>("");
  const [currentLoras, setCurrentLoras] = useState<SetLora[]>([]);

  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState<null | "refresh" | "setModel" | "setLoras" | "clearModel" | "clearLoras" | "generate">(
    null
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [loraPickerOpen, setLoraPickerOpen] = useState(false);

  const baseUrl: string = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8081";
  const urls = useMemo(() => {
    return {
      generate: new URL("generateimage", baseUrl),
      models: new URL("models", baseUrl),
      loras: new URL("loras", baseUrl),
      setModel: new URL("setmodel", baseUrl),
      setLoras: new URL("setloras", baseUrl),
      currentModel: new URL("currentmodel", baseUrl),
      currentLoras: new URL("currentloras", baseUrl),
      clearModel: new URL("clearmodel", baseUrl),
      clearLoras: new URL("clearloras", baseUrl),
    };
  }, [baseUrl]);

  const modelCatalog = useMemo(() => buildCatalog(availableModelPaths, "models"), [availableModelPaths]);
  const loraCatalog = useMemo(() => buildCatalog(availableLoraPaths, "loras"), [availableLoraPaths]);
  const modelGroups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of modelCatalog) {
      map.set(item.group, [...(map.get(item.group) ?? []), item]);
    }
    return map;
  }, [modelCatalog]);
  const loraGroups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of loraCatalog) {
      map.set(item.group, [...(map.get(item.group) ?? []), item]);
    }
    return map;
  }, [loraCatalog]);

  const selectedLoraCount = Object.keys(selectedLoras).length;
  const selectedModelLabel = useMemo(() => {
    if (!selectedModelPath) return "";
    const normalized = selectedModelPath.replaceAll("\\", "/");
    return normalized.split("/").slice(-1)[0] ?? selectedModelPath;
  }, [selectedModelPath]);
  const currentModelLabel = useMemo(() => {
    if (!currentModelPath) return "";
    const normalized = currentModelPath.replaceAll("\\", "/");
    return normalized.split("/").slice(-1)[0] ?? currentModelPath;
  }, [currentModelPath]);

  const refreshAll = async () => {
    setBusy("refresh");
    setStatus("");
    try {
      const [models, loras, currentModel, currentLorasResp] = await Promise.all([
        fetchJson<ModelsResponse>(urls.models),
        fetchJson<LorasResponse>(urls.loras),
        fetchJson<CurrentModelResponse>(urls.currentModel),
        fetchJson<SetLora[]>(urls.currentLoras),
      ]);
      setAvailableModelPaths(models.modelPaths ?? []);
      setAvailableLoraPaths(loras.lorapaths ?? []);
      setCurrentModelPath(currentModel.modelPath ?? "");
      setCurrentLoras(currentLorasResp ?? []);
      if (!selectedModelPath && currentModel.modelPath) setSelectedModelPath(currentModel.modelPath);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (previewSrc?.startsWith("blob:")) URL.revokeObjectURL(previewSrc);
    };
  }, [previewSrc]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("generate");
    setStatus("");
    try {
      const requestBody = {
        positivePrompt,
        negativePrompt,
      };

      const responseImage = await fetch(urls.generate.toString(), {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!responseImage.ok) throw new Error(`HTTP error! status: ${responseImage.status}`);

      const blob = await responseImage.blob();
      const objectUrl = URL.createObjectURL(blob);
      if (previewSrc?.startsWith("blob:")) URL.revokeObjectURL(previewSrc);
      setPreviewSrc(objectUrl);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const applyModel = async () => {
    if (!selectedModelPath) return;
    setBusy("setModel");
    setStatus("");
    try {
      const resp = await fetchJson<CurrentModelResponse>(urls.setModel, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelPath: selectedModelPath }),
      });
      setCurrentModelPath(resp.modelPath ?? "");
      setCurrentLoras([]);
      setSelectedLoras({});
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const applyLoras = async () => {
    const payload: SetLora[] = Object.entries(selectedLoras).map(([path, weight]) => ({ path, weight }));
    setBusy("setLoras");
    setStatus("");
    try {
      const applied = await fetchJson<SetLora[]>(urls.setLoras, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setCurrentLoras(applied ?? []);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const clearLoras = async () => {
    setBusy("clearLoras");
    setStatus("");
    try {
      await fetchJson<SetLora[]>(urls.clearLoras, { method: "POST" });
      setCurrentLoras([]);
      setSelectedLoras({});
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
      await fetchJson<{ modelPath: string; loras: SetLora[] }>(urls.clearModel, { method: "POST" });
      setCurrentModelPath("");
      setCurrentLoras([]);
      setSelectedModelPath("");
      setSelectedLoras({});
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    return () => {
      if (previewSrc) {
        URL.revokeObjectURL(previewSrc);
      }
    };
  }, [previewSrc]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-10 lg:grid-cols-[420px_1fr]">
        <section className="w-full space-y-6">
          <header className="space-y-1">
            <h1 className="text-3xl font-semibold tracking-tight">TypeTerrors</h1>
            <p className="text-sm text-muted-foreground">Model + LoRA management and image generation.</p>
          </header>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>Browse folders, apply a model, then apply LoRAs.</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={refreshAll} disabled={busy !== null}>
                {busy === "refresh" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
                  {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
                </Badge>
                <Badge variant="outline">{currentLoras.length} LoRAs applied</Badge>
              </div>

              <div className="space-y-2">
                <div className="text-sm font-medium">Select model</div>
                <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={modelPickerOpen}
                      className="w-full justify-between"
                      disabled={busy !== null}
                    >
                      {selectedModelPath ? selectedModelLabel : "Choose a model..."}
                      <ChevronsUpDown className="opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                      <CommandInput placeholder="Search models..." />
                      <CommandEmpty>No models found.</CommandEmpty>
                      <CommandList>
                        {[...modelGroups.entries()].map(([group, items]) => (
                          <CommandGroup key={group} heading={group}>
                            {items.map((item) => (
                              <CommandItem
                                key={item.fullPath}
                                value={`${group}/${item.name}`}
                                onSelect={() => {
                                  setSelectedModelPath(item.fullPath);
                                  setModelPickerOpen(false);
                                }}
                              >
                                <Check
                                  className={
                                    selectedModelPath === item.fullPath
                                      ? "mr-2 size-4 opacity-100"
                                      : "mr-2 size-4 opacity-0"
                                  }
                                />
                                <span className="truncate">{item.name}</span>
                                {currentModelPath === item.fullPath && (
                                  <Badge variant="secondary" className="ml-auto">
                                    Applied
                                  </Badge>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <div className="flex items-center gap-2">
                  <Button onClick={applyModel} disabled={!selectedModelPath || busy !== null}>
                    {busy === "setModel" ? <Loader2 className="animate-spin" /> : null}
                    Apply model
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={busy !== null || !currentModelPath}>
                        <Trash2 />
                        Clear model
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear current model?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This unloads the model and clears all applied LoRAs in the Python worker.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={clearModel}>Clear</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>

              <Separator />

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">LoRAs</div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{currentLoras.length} applied</Badge>
                    <Badge variant="outline">{selectedLoraCount} selected</Badge>
                  </div>
                </div>

                <Popover open={loraPickerOpen} onOpenChange={setLoraPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-between" disabled={busy !== null}>
                      Add LoRA...
                      <ChevronsUpDown className="opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                      <CommandInput placeholder="Search LoRAs..." />
                      <CommandEmpty>No LoRAs found.</CommandEmpty>
                      <CommandList>
                        {[...loraGroups.entries()].map(([group, items]) => (
                          <CommandGroup key={group} heading={group}>
                            {items.map((item) => (
                              <CommandItem
                                key={item.fullPath}
                                value={`${group}/${item.name}`}
                                onSelect={() => {
                                  setSelectedLoras((prev) => {
                                    if (Object.prototype.hasOwnProperty.call(prev, item.fullPath)) return prev;
                                    return { ...prev, [item.fullPath]: 1.0 };
                                  });
                                  setLoraPickerOpen(false);
                                }}
                              >
                                <Check
                                  className={
                                    Object.prototype.hasOwnProperty.call(selectedLoras, item.fullPath)
                                      ? "mr-2 size-4 opacity-100"
                                      : "mr-2 size-4 opacity-0"
                                  }
                                />
                                <span className="truncate">{item.name}</span>
                                {currentLoras.some((l) => l.path === item.fullPath) && (
                                  <Badge variant="secondary" className="ml-auto">
                                    Applied
                                  </Badge>
                                )}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                <div className="rounded-lg border">
                  <ScrollArea className="h-56">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead className="w-[110px]">Weight</TableHead>
                          <TableHead className="w-[90px]">State</TableHead>
                          <TableHead className="w-[44px]" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedLoraCount === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-muted-foreground">
                              No LoRAs selected.
                            </TableCell>
                          </TableRow>
                        ) : (
                          Object.entries(selectedLoras)
                            .sort(([a], [b]) => a.localeCompare(b))
                            .map(([path, weight]) => {
                              const name = path.replaceAll("\\", "/").split("/").slice(-1)[0] ?? path;
                              const isApplied = currentLoras.some((l) => l.path === path);
                              return (
                                <TableRow key={path}>
                                  <TableCell className="min-w-0">
                                    <div className="truncate font-medium" title={path}>
                                      {name}
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <Input
                                      type="number"
                                      inputMode="decimal"
                                      min={0.1}
                                      step={0.1}
                                      value={weight}
                                      onChange={(e) => {
                                        const next = Number(e.target.value);
                                        setSelectedLoras((prev) => ({
                                          ...prev,
                                          [path]: Number.isFinite(next) ? Math.max(0.1, next) : 1.0,
                                        }));
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell>
                                    {isApplied ? (
                                      <Badge variant="secondary">Applied</Badge>
                                    ) : (
                                      <Badge variant="outline">Selected</Badge>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={() => {
                                        setSelectedLoras((prev) => {
                                          const next = { ...prev };
                                          delete next[path];
                                          return next;
                                        });
                                      }}
                                      disabled={busy !== null}
                                    >
                                      <X />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              );
                            })
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>

                <div className="flex items-center gap-2">
                  <Button onClick={applyLoras} disabled={busy !== null || selectedLoraCount === 0}>
                    {busy === "setLoras" ? <Loader2 className="animate-spin" /> : null}
                    Apply LoRAs
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={busy !== null || currentLoras.length === 0}>
                        <Trash2 />
                        Clear LoRAs
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Clear all LoRAs?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This keeps the current model loaded but removes all applied LoRAs in the Python worker.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={clearLoras}>Clear</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Prompts</CardTitle>
              <CardDescription>Generate uses the currently applied model and LoRAs.</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-3">
                <Textarea
                  placeholder="Positive prompt..."
                  value={positivePrompt}
                  onChange={(e) => setPositivePrompt(e.target.value)}
                  rows={5}
                />
                <Textarea
                  placeholder="Negative prompt..."
                  value={negativePrompt}
                  onChange={(e) => setNegativePrompt(e.target.value)}
                  rows={3}
                />
              </CardContent>
              <CardFooter className="flex-col items-stretch gap-3">
                <Button type="submit" disabled={busy !== null}>
                  {busy === "generate" ? <Loader2 className="animate-spin" /> : null}
                  Generate
                </Button>

                {status && (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Request failed</AlertTitle>
                    <AlertDescription>{status}</AlertDescription>
                  </Alert>
                )}
              </CardFooter>
            </form>
          </Card>
        </section>

        <section className="w-full space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>Generated output from the worker.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
                  {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
                </Badge>
                {currentLoras.length > 0 ? (
                  currentLoras.slice(0, 6).map((l) => (
                    <Badge key={l.path} variant="outline" title={l.path}>
                      {l.path.replaceAll("\\", "/").split("/").slice(-1)[0]} ({l.weight})
                    </Badge>
                  ))
                ) : (
                  <Badge variant="outline">LoRAs: none</Badge>
                )}
                {currentLoras.length > 6 && <Badge variant="outline">+{currentLoras.length - 6} more</Badge>}
              </div>

              <Separator />

              <div className="flex items-center justify-center">
                <div className="relative inline-block overflow-hidden rounded-lg border bg-muted">
                  <img
                    key={previewSrc}
                    src={previewSrc}
                    alt="Generated preview"
                    className="block h-auto w-auto max-w-full"
                    onError={() => setStatus("Preview image failed to load (invalid image bytes or URL).")}
                  />
                  {busy === "generate" ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                      <Loader2 className="h-8 w-8 animate-spin" />
                    </div>
                  ) : null}
                </div>
              </div>
              {previewSrc.startsWith("blob:") ? (
                <Button asChild variant="secondary" className="w-full">
                  <a href={previewSrc} download="generated.png">
                    Download
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
