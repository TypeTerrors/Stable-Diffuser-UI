"use client";

import { DownloadModelById } from "@/components/download-model-by-id";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { BusyState } from "@/app/_home/types";

type Props = {
  busy: BusyState;
  downloadUrl: URL;
  clientId: string;
  onQueued: (event: { jobId: string; modelVersionId: number }) => void;
  onError: (message: string) => void;
};

export function DownloaderCard({ busy, downloadUrl, clientId, onQueued, onError }: Props) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader>
        <CardTitle>Downloader</CardTitle>
        <CardDescription>Download a model by its Civitai ID and auto-refresh the catalog on completion.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DownloadModelById downloadUrl={downloadUrl} clientId={clientId} disabled={busy !== null} onQueued={onQueued} onError={onError} />
        <p className="text-xs text-muted-foreground">Tip: keep this tab open while downloading so you receive the completion notification.</p>
      </CardContent>
    </Card>
  );
}
