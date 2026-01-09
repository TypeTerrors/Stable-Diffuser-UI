"use client";

import Image from "next/image";

import { AspectRatio } from "@/components/ui/aspect-ratio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";

import type { BusyState, PreviewState, SetLora } from "@/app/_home/types";
import { basename } from "@/app/_home/utils";

type Props = {
  busy: BusyState;
  onStatus: (value: string) => void;
  currentModelPath: string;
  currentModelLabel: string;
  currentLoras: SetLora[];
  previewSrc: string;
  downloadFilename: string;
  previewState: PreviewState;
  onPreviewState: React.Dispatch<React.SetStateAction<PreviewState>>;
  onClearHistory: () => void;
};

export function PreviewCard({
  busy,
  onStatus,
  currentModelPath,
  currentModelLabel,
  currentLoras,
  previewSrc,
  downloadFilename,
  previewState,
  onPreviewState,
  onClearHistory,
}: Props) {
  return (
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
                {basename(l.path)} ({l.weight})
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
                onError={() => onStatus("Preview image failed to load (invalid image bytes or URL).")}
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
                onClick={() => onPreviewState((prev) => ({ ...prev, index: Math.max(0, prev.index - 1) }))}
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
                onChange={(e) => onPreviewState((prev) => ({ ...prev, index: Number(e.target.value) }))}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Next image"
                disabled={previewState.index >= previewState.items.length - 1}
                onClick={() =>
                  onPreviewState((prev) => ({
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
              <Button type="button" variant="ghost" size="sm" onClick={onClearHistory}>
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
            <a href={previewSrc} download={downloadFilename}>
              Download
            </a>
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
