"use client";

import type { useHomeController } from "@/app/_home/useHomeController";
import { DownloadModelById } from "@/components/download-model-by-id";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type HomeController = ReturnType<typeof useHomeController>;

export function T2IDownloaderCard({ controller }: { controller: HomeController }) {
  const { urls, clientId, busy, pushToast } = controller;

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader>
        <CardTitle>Downloader</CardTitle>
        <CardDescription>Download a model by its ID and auto-refresh the catalog on completion.</CardDescription>
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
        <p className="text-xs text-muted-foreground">Tip: keep this tab open while downloading so you receive the completion notification.</p>
      </CardContent>
    </Card>
  );
}

