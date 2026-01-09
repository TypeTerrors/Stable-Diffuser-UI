"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

import type { BusyState } from "@/app/_home/types";

type Props = {
  busy: BusyState;
  currentModelPath: string;
  currentModelLabel: string;
  currentLorasCount: number;
  onRefresh: () => void;
};

export function HomeHeader({ busy, currentModelPath, currentModelLabel, currentLorasCount, onRefresh }: Props) {
  return (
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
        <Badge variant="outline">{currentLorasCount} LoRAs applied</Badge>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={busy !== null} className="gap-2">
          {busy === "refresh" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Refresh data
        </Button>
      </div>
    </div>
  );
}
