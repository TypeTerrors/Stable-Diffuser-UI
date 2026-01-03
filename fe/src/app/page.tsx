"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Check, ChevronsUpDown, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import Image from "next/image";

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
  const [previewTab, setPreviewTab] = useState<"preview" | "diff" | "logs">("preview");

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
  const loraDiff = useMemo(() => {
    const selectedEntries = Object.entries(selectedLoras);
    const selectedPaths = new Set(selectedEntries.map(([path]) => path));
    const appliedPaths = new Set(currentLoras.map((l) => l.path));

    const pendingApply = selectedEntries
      .filter(([path]) => !appliedPaths.has(path))
      .map(([path, weight]) => ({ path, weight }));
    const pendingRemove = currentLoras.filter((l) => !selectedPaths.has(l.path));
    const matching = selectedEntries
      .filter(([path]) => appliedPaths.has(path))
      .map(([path, weight]) => ({ path, weight }));

    return { pendingApply, pendingRemove, matching };
  }, [currentLoras, selectedLoras]);

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

  const InfoBadge = ({ label, value }: { label: string; value: string }) => (
    <div className="flex items-center gap-2 rounded-lg border border-white/15 bg-gradient-to-r from-indigo-600/30 via-rose-500/20 to-cyan-400/25 px-3 py-2 shadow-sm">
      <span className="text-xs uppercase tracking-wide text-indigo-100/80">{label}</span>
      <Badge variant="secondary" className="bg-white/20 text-sm font-semibold text-white hover:bg-white/30">
        {value}
      </Badge>
    </div>
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-purple-900 via-slate-900 to-indigo-900 text-foreground">
      <div className="mx-auto w-full max-w-screen-2xl space-y-10 px-6 py-10">
        <header className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-indigo-600/20 via-rose-500/10 to-cyan-400/20 p-8 shadow-2xl backdrop-blur">
          <div className="absolute -left-10 -top-10 h-48 w-48 rounded-full bg-indigo-500/30 blur-3xl" />
          <div className="absolute -bottom-12 right-6 h-56 w-56 rounded-full bg-rose-500/25 blur-3xl" />
          <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-indigo-200">TypeTerrors</p>
              <h1 className="text-4xl font-semibold tracking-tight text-white drop-shadow-sm">Neon Diffusion Studio</h1>
              <p className="max-w-3xl text-sm text-indigo-100/80">
                Curate models, stack LoRAs with precise weights, and ship clean generations with live diff + activity views.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                <InfoBadge label="Applied model" value={currentModelLabel || "None"} />
                <InfoBadge label="Applied LoRAs" value={currentLoras.length.toString()} />
                <InfoBadge label="API" value={baseUrl.replace(/^https?:\/\//, "")} />
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-white shadow-lg">
              <p className="text-xs uppercase tracking-wide text-indigo-100">Inventory snapshot</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-white/10 px-3 py-2 text-sm">
                  <p className="text-indigo-100/80">Models</p>
                  <p className="text-xl font-semibold">{availableModelPaths.length}</p>
                </div>
                <div className="rounded-lg bg-white/10 px-3 py-2 text-sm">
                  <p className="text-indigo-100/80">LoRAs</p>
                  <p className="text-xl font-semibold">{availableLoraPaths.length}</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="gap-2 self-start border border-white/20 bg-gradient-to-r from-cyan-500/80 to-indigo-500/80 text-white hover:from-cyan-400 hover:to-indigo-400"
                onClick={refreshAll}
                disabled={busy !== null}
              >
                {busy === "refresh" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Sync assets
              </Button>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
          <section className="w-full space-y-6 xl:col-span-5">
            <Card className="shadow-xl border-white/10 bg-slate-900/70">
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-xl text-white">Model setup</CardTitle>
                  <CardDescription className="mt-1 text-sm text-indigo-100/80">
                    Browse folders, apply a model, then layer in LoRAs with adjustable weights.
                  </CardDescription>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={refreshAll}
                  disabled={busy !== null}
                  className="gap-2 border border-white/20 bg-gradient-to-r from-cyan-500/80 to-indigo-500/80 text-white hover:from-cyan-400 hover:to-indigo-400"
                >
                  {busy === "refresh" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Refresh
                </Button>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-3 rounded-xl border border-indigo-500/20 bg-gradient-to-r from-indigo-700/40 via-slate-900 to-indigo-700/30 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""} className="bg-indigo-500/30 text-indigo-50">
                      {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
                    </Badge>
                    <Badge variant="outline" className="border-indigo-300/40 text-indigo-50">
                      {currentLoras.length} LoRAs applied
                    </Badge>
                    {currentLoras.length > 3 && (
                      <Badge variant="outline" className="bg-indigo-500/20 text-indigo-50">
                        {currentLoras.slice(0, 3).map((l) => l.path.replaceAll("\\", "/").split("/").slice(-1)[0]).join(", ")}
                        {currentLoras.length > 3 ? "…" : ""}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-indigo-100/80">
                    Apply a model first, then select LoRAs and tweak their weights before sending a generate request.
                  </p>
                </div>

                <div className="space-y-3 rounded-xl border border-white/10 bg-slate-800/60 p-4 shadow-inner">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">Model</p>
                      <p className="text-xs text-indigo-100/80">Pick the base checkpoint for generation.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-indigo-100/80">Select model</Label>
                    <Popover open={modelPickerOpen} onOpenChange={setModelPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={modelPickerOpen}
                          className="w-full justify-between border-indigo-300/50 bg-indigo-800/70 text-indigo-50 hover:bg-indigo-700/70"
                          disabled={busy !== null}
                        >
                          {selectedModelPath ? selectedModelLabel : "Choose a model..."}
                          <ChevronsUpDown className="size-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[min(620px,92vw)] border-indigo-500/40 bg-slate-900 p-0 shadow-2xl">
                        <Command className="w-full text-foreground">
                          <div className="p-3 pb-1">
                            <CommandInput placeholder="Search models..." />
                          </div>
                          <CommandEmpty className="px-3 pb-3 text-sm text-indigo-100/80">No models found.</CommandEmpty>
                          <ScrollArea className="max-h-[420px]">
                            <CommandList>
                              {[...modelGroups.entries()].map(([group, items]) => (
                                <CommandGroup key={group} heading={group}>
                                  {items.map((item) => (
                                    <CommandItem
                                      key={item.fullPath}
                                      value={`${group}/${item.name}`}
                                      className="flex items-start gap-2 py-2"
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
                                      <div className="flex flex-col gap-0.5 overflow-hidden">
                                        <span className="truncate font-medium">{item.name}</span>
                                        <span className="truncate text-xs text-muted-foreground">
                                          {item.subpath ? `${item.group}/${item.subpath}` : item.group}
                                        </span>
                                      </div>
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
                          </ScrollArea>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={applyModel}
                        disabled={!selectedModelPath || busy !== null}
                        className="gap-2 border border-white/20 bg-gradient-to-r from-indigo-500/90 to-rose-500/80 text-white hover:from-indigo-500 hover:to-rose-400"
                      >
                        {busy === "setModel" ? <Loader2 className="size-4 animate-spin" /> : null}
                        Apply model
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            disabled={busy !== null || !currentModelPath}
                            className="gap-2 bg-rose-600/80 text-white hover:bg-rose-500"
                          >
                            <Trash2 className="size-4" />
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
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="w-full xl:col-span-7">
            <Card className="sticky top-6 border-white/10 bg-slate-900/70 shadow-2xl">
              <CardHeader className="gap-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-white">Output console</CardTitle>
                    <CardDescription className="text-indigo-100/80">Switch between live preview, diff, and request logs.</CardDescription>
                  </div>
                  <div className="flex items-center gap-2 rounded-full bg-white/10 p-1 shadow-inner">
                    {(["preview", "diff", "logs"] as const).map((tab) => (
                      <Button
                        key={tab}
                        variant={previewTab === tab ? "secondary" : "ghost"}
                        size="sm"
                        className="capitalize"
                        onClick={() => setPreviewTab(tab)}
                      >
                        {tab}
                      </Button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewTab === "preview" && (
                  <div className="space-y-4">
                    <div className="grid gap-2 rounded-xl border border-indigo-500/30 bg-indigo-900/50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={currentModelPath ? "secondary" : "outline"}
                          title={currentModelPath || ""}
                          className="bg-indigo-500/40 text-indigo-50"
                        >
                          {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
                        </Badge>
                        {currentLoras.length > 0 ? (
                          currentLoras.slice(0, 6).map((l) => (
                            <Badge key={l.path} variant="outline" title={l.path} className="border-indigo-300/50 text-indigo-50">
                              {l.path.replaceAll("\\", "/").split("/").slice(-1)[0]} ({l.weight})
                            </Badge>
                          ))
                        ) : (
                          <Badge variant="outline" className="border-indigo-300/50 text-indigo-50">
                            LoRAs: none
                          </Badge>
                        )}
                        {currentLoras.length > 6 && (
                          <Badge variant="outline" className="border-indigo-300/50 text-indigo-50">
                            +{currentLoras.length - 6} more
                          </Badge>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-center">
                      <div className="relative inline-block max-w-3xl overflow-hidden rounded-xl border bg-muted shadow-inner">
                        <Image
                          key={previewSrc}
                          src={previewSrc}
                          alt="Generated preview"
                          width={1024}
                          height={1024}
                          unoptimized
                          className="h-auto w-full rounded-lg object-contain"
                          sizes="(min-width: 1024px) 1024px, 90vw"
                          onError={() => setStatus("Preview image failed to load (invalid image bytes or URL).")}
                          priority
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
                  </div>
                )}

                {previewTab === "diff" && (
                  <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-semibold">Changes before next generate</h3>
                      <Badge variant="outline">{selectedLoraCount} LoRAs selected</Badge>
                    </div>
                    <div className="grid gap-3">
                      <div className="flex flex-col gap-1 rounded-lg border bg-card/80 p-3 shadow-sm md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Model</p>
                          <p className="text-sm font-semibold">{selectedModelLabel || "None selected"}</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant={currentModelPath === selectedModelPath ? "secondary" : "outline"}>
                            Current: {currentModelLabel || "None"}
                          </Badge>
                          {selectedModelPath && currentModelPath !== selectedModelPath ? (
                            <Badge variant="outline">Will switch</Badge>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-2 rounded-lg border bg-card/80 p-3 shadow-sm">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">LoRA delta</p>
                        <div className="grid gap-2 md:grid-cols-3">
                          <div className="rounded-md border bg-background/70 p-3">
                            <p className="text-xs font-semibold text-muted-foreground">Will apply</p>
                            {loraDiff.pendingApply.length === 0 ? (
                              <p className="text-sm text-muted-foreground">None</p>
                            ) : (
                              <ul className="space-y-1 text-sm">
                                {loraDiff.pendingApply.map((l) => (
                                  <li key={l.path} className="flex items-center gap-2">
                                    <Badge variant="secondary">{l.weight}</Badge>
                                    <span className="truncate" title={l.path}>
                                      {l.path.replaceAll("\\", "/").split("/").slice(-1)[0]}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="rounded-md border bg-background/70 p-3">
                            <p className="text-xs font-semibold text-muted-foreground">Already applied</p>
                            {loraDiff.matching.length === 0 ? (
                              <p className="text-sm text-muted-foreground">None</p>
                            ) : (
                              <ul className="space-y-1 text-sm">
                                {loraDiff.matching.map((l) => (
                                  <li key={l.path} className="flex items-center gap-2">
                                    <Badge variant="outline">{l.weight}</Badge>
                                    <span className="truncate" title={l.path}>
                                      {l.path.replaceAll("\\", "/").split("/").slice(-1)[0]}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div className="rounded-md border bg-background/70 p-3">
                            <p className="text-xs font-semibold text-muted-foreground">Will remove</p>
                            {loraDiff.pendingRemove.length === 0 ? (
                              <p className="text-sm text-muted-foreground">None</p>
                            ) : (
                              <ul className="space-y-1 text-sm">
                                {loraDiff.pendingRemove.map((l) => (
                                  <li key={l.path} className="flex items-center gap-2">
                                    <Badge variant="destructive">{l.weight}</Badge>
                                    <span className="truncate" title={l.path}>
                                      {l.path.replaceAll("\\", "/").split("/").slice(-1)[0]}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {previewTab === "logs" && (
                  <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold">Activity log</h3>
                        <p className="text-xs text-muted-foreground">Last request status and helpful tips.</p>
                      </div>
                      <Badge variant="outline">{busy ? `Working: ${busy}` : "Idle"}</Badge>
                    </div>
                    <div className="rounded-lg border bg-card/80 p-3 shadow-sm">
                      {status ? (
                        <div className="flex items-start gap-3">
                          <AlertCircle className="mt-0.5 size-4 text-destructive" />
                          <div>
                            <p className="text-sm font-semibold text-destructive">Latest issue</p>
                            <p className="text-sm text-destructive">{status}</p>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No errors reported. You are good to generate.</div>
                      )}
                    </div>
                    <div className="grid gap-2 text-xs text-muted-foreground">
                      <p className="font-semibold uppercase tracking-wide text-foreground/80">Tips</p>
                      <ul className="space-y-1 list-disc pl-4">
                        <li>Refresh to sync model and LoRA catalogs before selecting.</li>
                        <li>Use the diff tab to confirm weights before applying.</li>
                        <li>Download the preview after a successful generate.</li>
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          <section className="w-full xl:col-span-12">
            <Card className="border-white/10 bg-slate-900/70 shadow-2xl">
              <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-white">LoRA lab</CardTitle>
                  <CardDescription className="text-indigo-100/80">Pick LoRAs, tune weights, and preview the delta before applying.</CardDescription>
                </div>
                <div className="flex items-center gap-2 text-xs text-indigo-100/80">
                  <Badge variant="outline" className="border-indigo-300/50 text-indigo-50">
                    {currentLoras.length} applied
                  </Badge>
                  <Badge variant="outline" className="border-indigo-300/50 text-indigo-50">
                    {selectedLoraCount} selected
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Popover open={loraPickerOpen} onOpenChange={setLoraPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="secondary"
                      className="w-full justify-between border border-indigo-400/50 bg-gradient-to-r from-indigo-600/80 via-rose-500/70 to-cyan-500/70 text-white hover:from-indigo-500 hover:to-cyan-400"
                      disabled={busy !== null}
                    >
                      Add LoRA...
                      <ChevronsUpDown className="size-4 opacity-70" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-[min(720px,94vw)] border-indigo-500/30 bg-slate-900 p-0 shadow-2xl">
                    <Command className="w-full text-foreground">
                      <div className="p-3 pb-1">
                        <CommandInput placeholder="Search LoRAs..." />
                      </div>
                      <CommandEmpty className="px-3 pb-3 text-sm text-indigo-100/80">No LoRAs found.</CommandEmpty>
                      <ScrollArea className="max-h-[420px]">
                        <CommandList>
                          {[...loraGroups.entries()].map(([group, items]) => (
                            <CommandGroup key={group} heading={group}>
                              {items.map((item) => (
                                <CommandItem
                                  key={item.fullPath}
                                  value={`${group}/${item.name}`}
                                  className="flex items-start gap-2 py-2"
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
                                  <div className="flex flex-col gap-0.5 overflow-hidden">
                                    <span className="truncate font-medium">{item.name}</span>
                                    <span className="truncate text-xs text-muted-foreground">
                                      {item.subpath ? `${item.group}/${item.subpath}` : item.group}
                                    </span>
                                  </div>
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
                      </ScrollArea>
                    </Command>
                  </PopoverContent>
                </Popover>

                <div className="rounded-xl border border-indigo-500/20 bg-indigo-900/40 p-4">
                  <ScrollArea className="max-h-[340px] pr-2">
                    <div className="grid gap-3">
                      {selectedLoraCount === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-indigo-400/30 bg-slate-800/70 px-4 py-6 text-center text-sm text-indigo-100/80">
                          <p className="font-medium">No LoRAs selected</p>
                          <p>Add LoRAs above to adjust their weights before applying.</p>
                        </div>
                      ) : (
                        Object.entries(selectedLoras)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([path, weight]) => {
                            const name = path.replaceAll("\\", "/").split("/").slice(-1)[0] ?? path;
                            const isApplied = currentLoras.some((l) => l.path === path);
                            return (
                              <div
                                key={path}
                                className="grid gap-4 rounded-lg border border-indigo-400/40 bg-slate-800/80 p-4 shadow-lg xl:grid-cols-[minmax(0,2fr)_minmax(220px,1fr)_auto] xl:items-center"
                              >
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="break-words font-medium leading-tight text-white" title={path}>
                                      {name}
                                    </span>
                                    {isApplied ? (
                                      <Badge variant="secondary" className="text-xs">
                                        Applied
                                      </Badge>
                                    ) : (
                                      <Badge variant="outline" className="text-xs">
                                        Selected
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="break-words text-xs text-indigo-100/80" title={path}>
                                    {path}
                                  </p>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <Label className="text-xs text-indigo-100/80">Weight</Label>
                                  <div className="flex items-center gap-3">
                                    <Input
                                      type="number"
                                      inputMode="decimal"
                                      min={0.1}
                                      step={0.1}
                                      value={weight}
                                      className="w-full max-w-[240px] rounded-lg"
                                      onChange={(e) => {
                                        const next = Number(e.target.value);
                                        setSelectedLoras((prev) => ({
                                          ...prev,
                                          [path]: Number.isFinite(next) ? Math.max(0.1, next) : 1.0,
                                        }));
                                      }}
                                    />
                                    <span className="text-xs text-muted-foreground">x</span>
                                  </div>
                                </div>
                                <div className="flex items-center justify-end gap-2 xl:justify-start">
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-full"
                                    onClick={() => {
                                      setSelectedLoras((prev) => {
                                        const next = { ...prev };
                                        delete next[path];
                                        return next;
                                      });
                                    }}
                                    disabled={busy !== null}
                                    aria-label={`Remove ${name}`}
                                  >
                                    <X className="size-4" />
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={applyLoras} disabled={busy !== null || selectedLoraCount === 0} className="gap-2">
                    {busy === "setLoras" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Apply LoRAs
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" disabled={busy !== null || currentLoras.length === 0} className="gap-2">
                        <Trash2 className="size-4" />
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
              </CardContent>
            </Card>
          </section>

          <section className="w-full xl:col-span-12">
            <Card className="border-white/10 bg-slate-900/70 shadow-2xl">
              <CardHeader>
                <CardTitle className="text-white">Prompts</CardTitle>
                <CardDescription className="text-indigo-100/80">Generation uses the currently applied model and LoRAs.</CardDescription>
              </CardHeader>
              <form onSubmit={handleSubmit}>
                <CardContent className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Positive prompt</Label>
                    <Textarea
                      placeholder="Describe what you want to see..."
                      value={positivePrompt}
                      onChange={(e) => setPositivePrompt(e.target.value)}
                      rows={6}
                    />
                    <p className="text-xs text-indigo-100/80">Use commas to separate concepts or add style hints.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Negative prompt</Label>
                    <Textarea
                      placeholder="Keep these elements out of the frame..."
                      value={negativePrompt}
                      onChange={(e) => setNegativePrompt(e.target.value)}
                      rows={6}
                    />
                    <p className="text-xs text-indigo-100/80">Optional: reduce artifacts or unwanted styles.</p>
                  </div>
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-3">
                  <Button type="submit" disabled={busy !== null} className="w-full gap-2">
                    {busy === "generate" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Generate
                  </Button>

                  {status && (
                    <Alert variant="destructive" className="border-rose-400/40 bg-rose-950/60 text-rose-50">
                      <AlertCircle className="size-4" />
                      <AlertTitle>Request failed</AlertTitle>
                      <AlertDescription>{status}</AlertDescription>
                    </Alert>
                  )}
                </CardFooter>
              </form>
            </Card>
          </section>
        </div>
      </div>
    </main>
  );
}
