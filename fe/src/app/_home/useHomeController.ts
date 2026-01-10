"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ToastItem } from "@/components/toast-stack";

import type {
  BusyState,
  CatalogItem,
  CurrentModelResponse,
  DownloadFilenamePayloadV1,
  DownloadEvent,
  LorasResponse,
  ModelsResponse,
  PreviewItem,
  PreviewState,
  SetLora,
} from "@/app/_home/types";
import { basename, buildCatalog, downloadFilenameFromPayloadV1, fetchJson, parseTriggerWords, pathTokenFromFullPath } from "@/app/_home/utils";

type Urls = {
  generate: URL;
  models: URL;
  loras: URL;
  setModel: URL;
  setLoras: URL;
  currentModel: URL;
  currentLoras: URL;
  clearModel: URL;
  clearLoras: URL;
  download: URL;
};

export function useHomeController() {
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  const [previewState, setPreviewState] = useState<PreviewState>({ items: [], index: -1 });
  const previewItemsRef = useRef<string[]>([]);
  const previewItem = previewState.index >= 0 ? (previewState.items[previewState.index] ?? null) : null;
  const previewSrc = previewItem?.src ?? "/file.svg";
  const previewDownloadFilename = previewItem?.filename ?? "generated.png";

  const [availableModelPaths, setAvailableModelPaths] = useState<string[]>([]);
  const [availableLoraPaths, setAvailableLoraPaths] = useState<string[]>([]);

  const [selectedModelPath, setSelectedModelPath] = useState<string>("");
  const [selectedLoras, setSelectedLoras] = useState<Record<string, number>>({});

  const [currentModelPath, setCurrentModelPath] = useState<string>("");
  const [currentLoras, setCurrentLoras] = useState<SetLora[]>([]);

  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState<BusyState>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [loraPickerOpen, setLoraPickerOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const triggerCacheRef = useRef<Map<string, string>>(new Map());

  const baseUrl: string = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";
  const urls: Urls = useMemo(() => {
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
  const selectedModelLabel = useMemo(() => (selectedModelPath ? basename(selectedModelPath) : ""), [selectedModelPath]);
  const currentModelLabel = useMemo(() => (currentModelPath ? basename(currentModelPath) : ""), [currentModelPath]);

  const dismissToast = (id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const pushToast = (toast: Omit<ToastItem, "id">, opts?: { timeoutMs?: number }) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const timeoutMs = opts?.timeoutMs ?? 7000;

    setToasts((prev) => [{ ...toast, id }, ...prev].slice(0, 4));
    const timer = window.setTimeout(() => dismissToast(id), timeoutMs);
    toastTimersRef.current.set(id, timer);
  };

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
    previewItemsRef.current = previewState.items.map((item) => item.src);
  }, [previewState.items]);

  useEffect(() => {
    return () => {
      for (const src of previewItemsRef.current) {
        if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
      }
    };
  }, []);

  const clearPreviewHistory = () => {
    setPreviewState((prev) => {
      for (const item of prev.items) {
        const src = item.src;
        if (src.startsWith("blob:")) URL.revokeObjectURL(src);
      }
      return { items: [], index: -1 };
    });
  };

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

      const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const payload: DownloadFilenamePayloadV1 = {
        v: 1,
        id,
        m: pathTokenFromFullPath(currentModelPath, "models"),
        l: (currentLoras ?? []).map((l) => [pathTokenFromFullPath(l.path, "loras"), l.weight]),
        pp: positivePrompt,
        np: negativePrompt,
      };
      const nextItem: PreviewItem = {
        src: objectUrl,
        payload,
        filename: downloadFilenameFromPayloadV1(payload, "png"),
      };
      setPreviewState((prev) => {
        const maxHistory = 50;
        let items = [...prev.items, nextItem];
        if (items.length > maxHistory) {
          const overflow = items.length - maxHistory;
          const removed = items.slice(0, overflow);
          for (const removedItem of removed) {
            const src = removedItem.src;
            if (src.startsWith("blob:")) URL.revokeObjectURL(src);
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

  return {
    urls,
    baseUrl,
    clientId,

    toasts,
    pushToast,
    dismissToast,

    busy,
    status,
    setStatus,

    refreshAll,

    availableModelPaths,
    availableLoraPaths,

    selectedModelPath,
    setSelectedModelPath,
    selectedModelLabel,
    modelPickerOpen,
    setModelPickerOpen,

    selectedLoras,
    setSelectedLoras,
    selectedLoraCount,
    loraPickerOpen,
    setLoraPickerOpen,

    currentModelPath,
    currentModelLabel,
    currentLoras,

    modelGroups,
    loraGroups,

    applyModel,
    clearModel,
    applyLoras,
    clearLoras,

    parseTriggerWords,
    copyToClipboard,

    positivePrompt,
    setPositivePrompt,
    negativePrompt,
    setNegativePrompt,
    handleSubmit,

    previewState,
    setPreviewState,
    previewSrc,
    previewDownloadFilename,
    clearPreviewHistory,
  };
}
