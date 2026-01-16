"use client";

import { useState } from "react";

import { I2VGenerateCard } from "@/components/i2v/i2v-generate-card";
import { I2VHeader } from "@/components/i2v/i2v-header";
import { I2VSetModelCard } from "@/components/i2v/i2v-set-model-card";

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").slice(-1)[0] ?? path;
}

export default function ImageToVideoPage() {
  const baseUrl: string = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";
  const [currentModelPath, setCurrentModelPath] = useState("");

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 to-background text-foreground">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <I2VHeader currentModelPath={currentModelPath} currentModelLabel={basename(currentModelPath)} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,520px)_1fr]">
          <section className="w-full space-y-6">
            <I2VSetModelCard baseUrl={baseUrl} onModelChanged={setCurrentModelPath} />
          </section>
          <section className="w-full space-y-6">
            <I2VGenerateCard baseUrl={baseUrl} disabled={!currentModelPath} />
          </section>
        </div>
      </div>
    </main>
  );
}

