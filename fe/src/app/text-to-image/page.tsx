"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { apiUrl, parseFilename } from "@/lib/api";

export default function Home() {
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [previewSrc, setPreviewSrc] = useState("/file.svg");
  const [downloadName, setDownloadName] = useState("generated.png");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const requestBody = {
        positivePrompt,
        negativePrompt,
      };

      const responseImage = await fetch(apiUrl("/generateimage"), {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!responseImage.ok) {
        const text = await responseImage.text().catch(() => "");
        throw new Error(text || `HTTP error! status: ${responseImage.status}`);
      }

      const filename =
        parseFilename(responseImage.headers.get("content-disposition")) ??
        "generated.png";
      const blob = await responseImage.blob();
      const objectUrl = URL.createObjectURL(blob);
      setPreviewSrc(objectUrl);
      setDownloadName(filename);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(()=>{
    return () => {
      if (previewSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(previewSrc)
      }
    }
  }, [previewSrc]);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 lg:flex-row">
        <section className="w-full space-y-6 lg:w-1/2">
          <header>
            <div className="flex items-baseline justify-between gap-4">
              <h1 className="text-3xl font-semibold">Text to Image</h1>
              <Button asChild variant="secondary" className="shrink-0">
                <Link href="/">Change service</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Describe what you want and what to avoid.</p>
          </header>

          <Separator />

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="positivePrompt">Positive prompt</Label>
              <Textarea
                id="positivePrompt"
                placeholder="A cinematic photo of..."
                value={positivePrompt}
                onChange={(e) => setPositivePrompt(e.target.value)}
                rows={6}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="negativePrompt">Negative prompt</Label>
              <Textarea
                id="negativePrompt"
                placeholder="Low quality, blurry, ..."
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={4}
              />
            </div>

            {errorMessage ? (
              <p className="text-sm text-destructive">{errorMessage}</p>
            ) : null}

            <Button type="submit" className="w-full sm:w-auto" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating…
                </>
              ) : (
                "Generate"
              )}
            </Button>
          </form>
        </section>

        <section className="w-full lg:w-1/2">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-center">
              <div className="relative inline-block overflow-hidden rounded-lg border bg-muted">
                <img
                  src={previewSrc}
                  alt="Generated preview"
                  className="block h-auto w-auto max-w-full"
                />
                {isLoading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : null}
              </div>
            </div>
            {previewSrc.startsWith("blob:") ? (
              <Button asChild variant="secondary" className="mt-4 w-full">
                <a href={previewSrc} download={downloadName}>
                  Download
                </a>
              </Button>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
