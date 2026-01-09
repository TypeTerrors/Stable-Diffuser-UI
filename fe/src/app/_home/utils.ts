import type { CatalogItem, DownloadFilenamePayloadV1 } from "@/app/_home/types";

export function buildCatalog(paths: string[], marker: "models" | "loras"): CatalogItem[] {
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

export async function fetchJson<T>(url: URL, init?: RequestInit): Promise<T> {
  const resp = await fetch(url.toString(), init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  return (await resp.json()) as T;
}

export function parseTriggerWords(value: string | null | undefined): string[] {
  const raw = (value ?? "").trim();
  if (!raw) return [];
  const parts = raw.includes(",") ? raw.split(",") : raw.split("-");
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p, idx, arr) => arr.indexOf(p) === idx);
}

export function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").slice(-1)[0] ?? path;
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return base64.replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function encodeJsonToBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  return base64UrlFromBytes(bytes);
}

export function downloadFilenameFromPayloadV1(payload: DownloadFilenamePayloadV1, extension: "png" | "jpg" | "webp" = "png"): string {
  return `${encodeJsonToBase64Url(payload)}.${extension}`;
}
