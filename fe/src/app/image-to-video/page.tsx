"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl, parseFilename } from "@/lib/api";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Unexpected file reader result"));
        return;
      }
      const comma = reader.result.indexOf(",");
      resolve(comma >= 0 ? reader.result.slice(comma + 1) : reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function ImageToVideoPage() {
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputImageUrl, setInputImageUrl] = useState<string | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [downloadName, setDownloadName] = useState("generated.mp4");

  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canSubmit = useMemo(() => !!selectedFile && !isLoading, [selectedFile, isLoading]);

  useEffect(() => {
    if (!selectedFile) {
      setInputImageUrl(null);
      return;
    }

    const url = URL.createObjectURL(selectedFile);
    setInputImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    if (!selectedFile) {
      setErrorMessage("Select an image first.");
      return;
    }

    setIsLoading(true);
    try {
      if (videoUrl?.startsWith("blob:")) URL.revokeObjectURL(videoUrl);
      setVideoUrl(null);

      const imageBytes = await fileToBase64(selectedFile);
      const response = await fetch(apiUrl("/generateimagetovideo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBytes,
          positivePrompt,
          negativePrompt,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(text || `HTTP error! status: ${response.status}`);
      }

      const filename =
        parseFilename(response.headers.get("content-disposition")) ?? "generated.mp4";
      setDownloadName(filename);

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setVideoUrl(objectUrl);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-12 lg:flex-row">
        <section className="w-full space-y-6 lg:w-1/2">
          <header>
            <div className="flex items-baseline justify-between gap-4">
              <h1 className="text-3xl font-semibold">Image to Video</h1>
              <Button asChild variant="secondary" className="shrink-0">
                <Link href="/">Change service</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload an input image, add optional prompts, and generate a short video.
            </p>
          </header>

          <Separator />

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="imageUpload">Input image</Label>
              <input
                id="imageUpload"
                type="file"
                accept="image/*"
                className="block w-full rounded-md border bg-background px-3 py-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-secondary-foreground hover:file:bg-secondary/80"
                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                disabled={isLoading}
              />
            </div>

            {inputImageUrl ? (
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted">
                  <img
                    src={inputImageUrl}
                    alt="Input preview"
                    className="max-h-[360px] w-full object-contain"
                  />
                </div>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="positivePrompt">Positive prompt</Label>
              <Textarea
                id="positivePrompt"
                placeholder="Describe the motion/scene..."
                value={positivePrompt}
                onChange={(e) => setPositivePrompt(e.target.value)}
                rows={4}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="negativePrompt">Negative prompt</Label>
              <Textarea
                id="negativePrompt"
                placeholder="What to avoid..."
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                rows={3}
                disabled={isLoading}
              />
            </div>

            {errorMessage ? (
              <p className="text-sm text-destructive">{errorMessage}</p>
            ) : null}

            <Button type="submit" className="w-full sm:w-auto" disabled={!canSubmit}>
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
            <div className="relative flex min-h-[360px] items-center justify-center overflow-hidden rounded-lg bg-muted">
              {videoUrl ? (
                <video
                  src={videoUrl}
                  controls
                  className="h-full w-full rounded-lg object-contain"
                />
              ) : (
                <p className="text-sm text-muted-foreground">Generated video will appear here.</p>
              )}

              {isLoading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : null}
            </div>

            {videoUrl ? (
              <Button asChild variant="secondary" className="mt-4 w-full">
                <a href={videoUrl} download={downloadName}>
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

