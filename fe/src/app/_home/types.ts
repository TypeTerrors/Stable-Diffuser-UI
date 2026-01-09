export type ModelsResponse = { modelPaths: string[] };
export type LorasResponse = { lorapaths: string[] };

export type SetLora = { path: string; weight: number; triggerWords?: string | null };
export type CurrentModelResponse = { modelPath: string };
export type DownloadEvent = { type: string; jobId: string; modelVersionId: number; message?: string; path?: string };

export type CatalogItem = {
  fullPath: string;
  group: string;
  name: string;
  subpath: string;
};

export type DownloadFilenamePayloadV1 = {
  v: 1;
  id: string;
  m: string;
  l: Array<[path: string, weight: number]>;
  pp: string;
  np: string;
};

export type PreviewItem = {
  src: string;
  filename: string;
  payload: DownloadFilenamePayloadV1;
};

export type PreviewState = { items: PreviewItem[]; index: number };

export type BusyState = null | "refresh" | "setModel" | "setLoras" | "clearModel" | "clearLoras" | "generate";
