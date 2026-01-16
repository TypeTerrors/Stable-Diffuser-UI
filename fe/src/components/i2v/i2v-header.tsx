"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";

export function I2VHeader({
  currentModelPath,
  currentModelLabel,
}: {
  currentModelPath: string;
  currentModelLabel: string;
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <header className="space-y-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Link href="/" className="hover:underline">
            TypeTerrors
          </Link>
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Image to video</h1>
        <p className="text-sm text-muted-foreground">Set an LTX i2v model, then upload an image and generate a short clip.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={currentModelPath ? "secondary" : "outline"} title={currentModelPath || ""}>
          {currentModelPath ? `Model: ${currentModelLabel}` : "Model: none"}
        </Badge>
      </div>
    </div>
  );
}

