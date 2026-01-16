"use client";

import { useHomeController } from "@/app/_home/useHomeController";
import { ToastStack } from "@/components/toast-stack";
import { T2IConfigurationCard } from "@/components/t2i/t2i-configuration-card";
import { T2IDownloaderCard } from "@/components/t2i/t2i-downloader-card";
import { T2IHeader } from "@/components/t2i/t2i-header";
import { T2IPreviewCard } from "@/components/t2i/t2i-preview-card";
import { T2IPromptsCard } from "@/components/t2i/t2i-prompts-card";

export default function TextToImagePage() {
  const controller = useHomeController({ modelType: "t2i" });

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 to-background text-foreground">
      <ToastStack toasts={controller.toasts} onDismiss={controller.dismissToast} />
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <T2IHeader
          currentModelPath={controller.currentModelPath}
          currentModelLabel={controller.currentModelLabel}
          currentLoraCount={controller.currentLoras.length}
          busy={controller.busy !== null}
          onRefresh={controller.refreshAll}
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,520px)_1fr]">
          <section className="w-full space-y-6">
            <T2IConfigurationCard controller={controller} />
            <T2IDownloaderCard controller={controller} />
            <T2IPromptsCard controller={controller} />
          </section>

          <section className="w-full space-y-4 lg:sticky lg:top-8">
            <T2IPreviewCard controller={controller} />
          </section>
        </div>
      </div>
    </main>
  );
}

