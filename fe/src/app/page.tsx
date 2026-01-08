"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { DownloadModelById } from "@/components/download-model-by-id";
import { ToastItem, ToastStack } from "@/components/toast-stack";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
import { AlertCircle, Check, ChevronLeft, ChevronRight, ChevronsUpDown, Loader2, RefreshCw, Trash2, X } from "lucide-react";

type ModelsResponse = { modelPaths: string[] };
type LorasResponse = { lorapaths: string[] };
type SetLora = { path: string; weight: number; triggerWords?: string | null };
type CurrentModelResponse = { modelPath: string };
type DownloadEvent = { type: string; jobId: string; modelVersionId: number; message?: string; path?: string };

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
  const [previewState, setPreviewState] = useState<{ items: string[]; index: number }>({ items: [], index: -1 });
  const previewItemsRef = useRef<string[]>([]);
  const previewSrc = previewState.index >= 0 ? previewState.items[previewState.index] ?? "/file.svg" : "/file.svg";

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

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const triggerCacheRef = useRef<Map<string, string>>(new Map());

  const baseUrl: string = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";
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
      download: new URL("download", baseUrl),
    };
  }, [baseUrl]);

  const [clientId, setClientId] = useState("");

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
      const mergedCurrent = (currentLorasResp ?? []).map((l) => ({
        ...l,
        triggerWords: l.triggerWords ?? triggerCacheRef.current.get(l.path) ?? null,
      }));
      setCurrentLoras(mergedCurrent);
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
    if (typeof window === "undefined") return;
    const key = "tt.clientId";
    const existing = window.sessionStorage.getItem(key);
    if (existing) {
      setClientId(existing);
      return;
    }

    const next = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    window.sessionStorage.setItem(key, next);
    setClientId(next);
  }, []);

  const pushToast = (toast: Omit<ToastItem, "id">, opts?: { timeoutMs?: number }) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const timeoutMs = opts?.timeoutMs ?? 7000;

    setToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 4));
    const timer = window.setTimeout(() => dismissToast(id), timeoutMs);
    toastTimersRef.current.set(id, timer);
  };

  const dismissToast = (id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (!clientId) return;

    const wsBase = baseUrl.startsWith("https://") ? baseUrl.replace(/^https:\/\//, "wss://") : baseUrl.replace(/^http:\/\//, "ws://");
    const wsUrl = new URL(`ws/${clientId}`, wsBase);

    let ws: WebSocket | null = new WebSocket(wsUrl.toString());
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as DownloadEvent;
        if (!data?.type) return;

        if (data.type === "download.completed") {
          pushToast({
            variant: "success",
            title: `Download complete (id ${data.modelVersionId})`,
            description: data.path ? `Saved to: ${data.path}` : "Saved successfully.",
          });
          refreshAll();
        } else if (data.type === "download.failed") {
          pushToast({
            variant: "error",
            title: `Download failed (id ${data.modelVersionId})`,
            description: data.message || "The download job reported a failure.",
          });
        }
      } catch {
        // ignore non-JSON messages
      }
    };
    ws.onclose = () => {
      ws = null;
    };
    ws.onerror = () => {
      // Browser will also fire close; keep noise low.
    };

    return () => {
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, clientId]);

  useEffect(() => {
    previewItemsRef.current = previewState.items;
  }, [previewState.items]);

  useEffect(() => {
    return () => {
      for (const src of previewItemsRef.current) {
        if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
      }
    };
  }, []);

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
      setPreviewState((prev) => {
        const maxHistory = 50;
        let items = [...prev.items, objectUrl];
        if (items.length > maxHistory) {
          const overflow = items.length - maxHistory;
          const removed = items.slice(0, overflow);
          for (const src of removed) {
            if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
          }
          items = items.slice(overflow);
        }
        return { items, index: items.length - 1 };
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const clearPreviewHistory = () => {
    setPreviewState((prev) => {
      for (const src of prev.items) {
        if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
      }
      return { items: [], index: -1 };
    });
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
      for (const l of applied ?? []) {
        if (l.triggerWords) triggerCacheRef.current.set(l.path, l.triggerWords);
      }
      setCurrentLoras((applied ?? []).map((l) => ({ ...l, triggerWords: l.triggerWords ?? triggerCacheRef.current.get(l.path) ?? null })));
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

  const parseTriggerWords = (value: string | null | undefined): string[] => {
    const raw = (value ?? "").trim();
    if (!raw) return [];
    const parts = raw.includes(",") ? raw.split(",") : raw.split("-");
    return parts
      .map((p) => p.trim())
      .filter(Boolean)
      .filter((p, idx, arr) => arr.indexOf(p) === idx);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      pushToast({ variant: "success", title: "Copied to clipboard", description: text }, { timeoutMs: 2000 });
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!ok) throw new Error("copy failed");
        pushToast({ variant: "success", title: "Copied to clipboard", description: text }, { timeoutMs: 2000 });
      } catch (e) {
        pushToast({ variant: "error", title: "Copy failed", description: e instanceof Error ? e.message : String(e) });
      }
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 to-background text-foreground">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <header className="space-y-1">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">TypeTerrors</p>
            <h1 className="text-3xl font-semibold tracking-tight">Model + LoRA management</h1>
            <p className="text-sm text-muted-foreground">Curate your base model, stack LoRAs, and iterate on prompts.</p>
          </header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
              {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
            </Badge>
            <Badge variant="outline">{currentLoras.length} LoRAs applied</Badge>
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={busy !== null} className="gap-2">
              {busy === "refresh" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Refresh data
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,520px)_1fr]">
          <section className="w-full space-y-6">
            <Card className="border-muted-foreground/10 shadow-sm">
              <CardHeader className="space-y-2">
                <CardTitle>Configuration</CardTitle>
                <CardDescription>Browse folders, apply a model, then layer LoRAs with clear feedback.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="rounded-lg border bg-muted/40 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
                      {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
                    </Badge>
                    <Badge variant="outline">{currentLoras.length} LoRAs applied</Badge>
                    <Badge variant="outline">{selectedLoraCount} selected</Badge>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">Select model</div>
                      <p className="text-xs text-muted-foreground">Pick a base before applying LoRAs.</p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={busy !== null || !currentModelPath} className="gap-1">
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
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={applyModel} disabled={!selectedModelPath || busy !== null}>
                      {busy === "setModel" ? <Loader2 className="animate-spin" /> : null}
                      Apply model
                    </Button>
                    <p className="text-xs text-muted-foreground">Applied models clear any previously loaded LoRAs.</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">LoRAs</div>
                      <p className="text-xs text-muted-foreground">Select multiple, adjust their weights, then apply.</p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
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

                  <div className="overflow-hidden rounded-lg border">
                    <ScrollArea className="h-60 w-full">
                      <Table className="min-w-[640px]">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-1/2">Name</TableHead>
                            <TableHead className="w-[160px] text-right">Weight</TableHead>
                            <TableHead className="w-[110px]">State</TableHead>
                            <TableHead className="w-[60px]" />
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
                                      <p className="text-xs text-muted-foreground">{path}</p>
                                    </TableCell>
                                    <TableCell className="text-right">
                                      <Input
                                        type="number"
                                        inputMode="decimal"
                                        min={0.1}
                                        step={0.1}
                                        value={weight}
                                        className="h-10 w-full min-w-[150px] font-mono text-right"
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
                                    <TableCell className="text-right">
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
                                        aria-label={`Remove ${name}`}
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
                      <ScrollBar orientation="horizontal" />
                    </ScrollArea>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
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

                  {currentLoras.length > 0 ? (
                    <div className="space-y-3">
                      <Separator />
                      <div className="space-y-1">
                        <div className="text-sm font-medium">Trigger words</div>
                        <p className="text-xs text-muted-foreground">Click a badge to copy it, then paste into your prompt.</p>
                      </div>
                      <div className="space-y-3">
                        {currentLoras.map((l) => {
                          const name = l.path.replaceAll("\\", "/").split("/").slice(-1)[0] ?? l.path;
                          const words = parseTriggerWords(l.triggerWords);
                          return (
                            <div key={l.path} className="space-y-2 rounded-lg border bg-muted/40 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge variant="secondary" title={l.path}>
                                  {name}
                                </Badge>
                                <Badge variant="outline">weight {l.weight}</Badge>
                              </div>
                              {words.length > 0 ? (
                                <div className="flex flex-wrap gap-2">
                                  {words.map((w) => (
                                    <Badge asChild key={w} variant="outline">
                                      <button type="button" className="cursor-pointer" onClick={() => copyToClipboard(w)} title="Copy">
                                        {w}
                                      </button>
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">No trigger words (or failed to fetch).</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            <Card className="border-muted-foreground/10 shadow-sm">
              <CardHeader>
                <CardTitle>Downloader</CardTitle>
                <CardDescription>Download a model by its Civitai ID and auto-refresh the catalog on completion.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <DownloadModelById
                  downloadUrl={urls.download}
                  clientId={clientId}
                  disabled={busy !== null}
                  onQueued={({ jobId, modelVersionId }) => {
                    pushToast({
                      variant: "info",
                      title: `Download started (id ${modelVersionId})`,
                      description: `Job: ${jobId}`,
                    });
                  }}
                  onError={(message) => {
                    pushToast({ variant: "error", title: "Failed to start download", description: message });
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Tip: keep this tab open while downloading so you receive the completion notification.
                </p>
              </CardContent>
            </Card>

            <Card className="border-muted-foreground/10 shadow-sm">
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

          <section className="w-full space-y-4 lg:sticky lg:top-8">
            <Card className="border-muted-foreground/10 shadow-sm">
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

                <div className="relative">
                  <AspectRatio ratio={1}>
                    <div className="absolute inset-0 overflow-hidden rounded-lg border bg-muted">
                      <Image
                        key={previewSrc}
                        src={previewSrc || "/file.svg"}
                        alt="Generated preview"
                        fill
                        className="object-contain"
                        sizes="(min-width: 1280px) 540px, 100vw"
                        onError={() => setStatus("Preview image failed to load (invalid image bytes or URL).")}
                      />
                      {busy === "generate" ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                          <Loader2 className="h-8 w-8 animate-spin" />
                        </div>
                      ) : null}
                    </div>
                  </AspectRatio>
                </div>
                {previewState.items.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Previous image"
                        disabled={previewState.index <= 0}
                        onClick={() =>
                          setPreviewState((prev) => ({ ...prev, index: Math.max(0, prev.index - 1) }))
                        }
                      >
                        <ChevronLeft />
                      </Button>
                      <input
                        type="range"
                        className="w-full"
                        aria-label="Image history slider"
                        min={0}
                        max={Math.max(0, previewState.items.length - 1)}
                        step={1}
                        value={previewState.index}
                        onChange={(e) => setPreviewState((prev) => ({ ...prev, index: Number(e.target.value) }))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Next image"
                        disabled={previewState.index >= previewState.items.length - 1}
                        onClick={() =>
                          setPreviewState((prev) => ({
                            ...prev,
                            index: Math.min(prev.items.length - 1, prev.index + 1),
                          }))
                        }
                      >
                        <ChevronRight />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {previewState.index + 1} / {previewState.items.length}
                      </span>
                      <Button type="button" variant="ghost" size="sm" onClick={clearPreviewHistory}>
                        <Trash2 className="size-4" />
                        Clear history
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Generate an image to start a history.</p>
                )}
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
      </div>
    </main>
  );
}
