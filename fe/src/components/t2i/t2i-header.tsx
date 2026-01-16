"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function T2IHeader({
  currentModelPath,
  currentModelLabel,
  currentLoraCount,
  busy,
  onRefresh,
}: {
  currentModelPath: string;
  currentModelLabel: string;
  currentLoraCount: number;
  busy: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <header className="space-y-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Link href="/" className="hover:underline">
            TypeTerrors
          </Link>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Text to image</h1>
        <p className="text-sm text-muted-foreground">Curate your base model, stack LoRAs, and iterate on prompts.</p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
          {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
        </Badge>
        <Badge variant="outline">{currentLoraCount} LoRAs applied</Badge>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy} className="gap-2">
          <RefreshCw className="size-4" />
          Refresh data
        </Button>
      </div>
    </div>
  );
}

