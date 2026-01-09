"use client";

import { ToastStack } from "@/components/toast-stack";

import { ConfigurationCard } from "@/app/_home/components/ConfigurationCard";
import { DownloaderCard } from "@/app/_home/components/DownloaderCard";
import { HomeHeader } from "@/app/_home/components/HomeHeader";
import { PreviewCard } from "@/app/_home/components/PreviewCard";
import { PromptsCard } from "@/app/_home/components/PromptsCard";
import { useHomeController } from "@/app/_home/useHomeController";

export default function Home() {
  const c = useHomeController();

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 to-background text-foreground">
      <ToastStack toasts={c.toasts} onDismiss={c.dismissToast} />
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
        <HomeHeader
          busy={c.busy}
          currentModelPath={c.currentModelPath}
          currentModelLabel={c.currentModelLabel}
          currentLorasCount={c.currentLoras.length}
          onRefresh={c.refreshAll}
        />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,520px)_1fr]">
          <section className="w-full space-y-6">
            <ConfigurationCard
              busy={c.busy}
              currentModelPath={c.currentModelPath}
              currentModelLabel={c.currentModelLabel}
              currentLoras={c.currentLoras}
              modelGroups={c.modelGroups}
              selectedModelPath={c.selectedModelPath}
              selectedModelLabel={c.selectedModelLabel}
              modelPickerOpen={c.modelPickerOpen}
              onModelPickerOpenChange={c.setModelPickerOpen}
              onSelectModel={c.setSelectedModelPath}
              onApplyModel={c.applyModel}
              onClearModel={c.clearModel}
              loraGroups={c.loraGroups}
              selectedLoras={c.selectedLoras}
              onSelectedLoras={c.setSelectedLoras}
              selectedLoraCount={c.selectedLoraCount}
              loraPickerOpen={c.loraPickerOpen}
              onLoraPickerOpenChange={c.setLoraPickerOpen}
              onApplyLoras={c.applyLoras}
              onClearLoras={c.clearLoras}
              onCopyToClipboard={c.copyToClipboard}
            />

            <DownloaderCard
              busy={c.busy}
              downloadUrl={c.urls.download}
              clientId={c.clientId}
              onQueued={({ jobId, modelVersionId }) => {
                c.pushToast({
                  variant: "info",
                  title: `Download started (id ${modelVersionId})`,
                  description: `Job: ${jobId}`,
                });
              }}
              onError={(message) => {
                c.pushToast({ variant: "error", title: "Failed to start download", description: message });
              }}
            />

            <PromptsCard
              busy={c.busy}
              status={c.status}
              positivePrompt={c.positivePrompt}
              negativePrompt={c.negativePrompt}
              onChangePositive={c.setPositivePrompt}
              onChangeNegative={c.setNegativePrompt}
              onSubmit={c.handleSubmit}
            />
          </section>

          <section className="w-full space-y-4 lg:sticky lg:top-8">
            <PreviewCard
              busy={c.busy}
              onStatus={c.setStatus}
              currentModelPath={c.currentModelPath}
              currentModelLabel={c.currentModelLabel}
              currentLoras={c.currentLoras}
              previewSrc={c.previewSrc}
              downloadFilename={c.previewDownloadFilename}
              previewState={c.previewState}
              onPreviewState={c.setPreviewState}
              onClearHistory={c.clearPreviewHistory}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
