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

export function pathTokenFromFullPath(fullPath: string, marker: "models" | "loras"): string {
  const normalized = (fullPath ?? "").replaceAll("\\", "/").trim();
  if (!normalized) return "";

  const token = `/${marker}/`;
  if (normalized.includes(token)) {
    const rel = normalized.split(token)[1];
    if (rel) return rel;
  }

  return basename(normalized);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  // Keep padding so the encoded value is well-formed base64 (after base64url alphabet swaps),
  // which makes it easier to round-trip with common tools and avoids "invalid input" from strict decoders.
  return base64.replaceAll("+", "-").replaceAll("/", "_");
}

function bytesFromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const remainder = normalized.length % 4;
  const padded = remainder === 0 ? normalized : normalized + "=".repeat(4 - remainder);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeJsonToBase64Url(value: unknown): string {
  const json = JSON.stringify(value);
  if (json == null) throw new Error("Failed to serialize payload to JSON.");
  const bytes = new TextEncoder().encode(json);
  return base64UrlFromBytes(bytes);
}

export function decodeBase64UrlToJson<T>(value: string): T {
  const bytes = bytesFromBase64Url(value);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

export function downloadFilenameFromPayloadV1(payload: DownloadFilenamePayloadV1, extension: "png" | "jpg" | "webp" = "png"): string {
  // Put the uid first so users can visually associate the file with the settings inside the payload.
  //
  // Important: browsers/OSes often truncate very long download filenames. Since this payload can include
  // long prompts, we fall back to a smaller descriptor that still round-trips as valid JSON.
  // Use "__" rather than "::" because some clients sanitize ":" in downloaded filenames.
  const delimiter = "__";
  const maxFilenameChars = 200;

  const tryName = (value: unknown) => `${payload.id}${delimiter}${encodeJsonToBase64Url(value)}.${extension}`;
  const full = tryName(payload);
  if (full.length <= maxFilenameChars) return full;

  const loraLimits = [8, 6, 4, 2, 1, 0];
  const promptLimits = [160, 120, 80, 40, 0];
  for (const loraLimit of loraLimits) {
    for (const promptLimit of promptLimits) {
      const descriptor = {
        v: 1 as const,
        id: payload.id,
        m: payload.m,
        l: payload.l.slice(0, loraLimit),
        pp: payload.pp.slice(0, promptLimit),
        np: payload.np.slice(0, promptLimit),
        ppl: payload.pp.length,
        npl: payload.np.length,
      };
      const name = tryName(descriptor);
      if (name.length <= maxFilenameChars) return name;
    }
  }

  return `${payload.id}.${extension}`;
}

export function payloadV1FromDownloadFilename(filename: string): DownloadFilenamePayloadV1 | null {
  const name = filename.split("/").pop() ?? filename;
  const base = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  // Some browsers sanitize ':' in download filenames (commonly to '_') for cross-platform safety.
  const delimiter = base.includes("::") ? "::" : base.includes("__") ? "__" : null;
  const parts = delimiter ? base.split(delimiter) : [base];
  const encoded = parts.length >= 2 ? parts.slice(1).join(delimiter ?? "::") : parts[0];
  if (!encoded) return null;
  try {
    const value = decodeBase64UrlToJson<Partial<DownloadFilenamePayloadV1> & { v?: unknown }>(encoded);
    if (value?.v !== 1) return null;
    if (typeof value.id !== "string" || !value.id) return null;
    return {
      v: 1,
      id: value.id,
      m: typeof value.m === "string" ? value.m : "",
      l: Array.isArray(value.l) ? (value.l as Array<[string, number]>) : [],
      pp: typeof value.pp === "string" ? value.pp : "",
      np: typeof value.np === "string" ? value.np : "",
    };
  } catch {
    return null;
  }
}
