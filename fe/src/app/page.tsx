"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { AspectRatio } from "@/components/ui/aspect-ratio";

function parseFilename(contentDisposition: string | null): string | null {
  if (!contentDisposition) return null;
  const match =
    contentDisposition.match(/filename\*=UTF-8''([^;]+)/i) ??
    contentDisposition.match(/filename="?([^\";]+)"?/i);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export default function Home() {
  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [previewSrc, setPreviewSrc] = useState("/placeholder.png");
  const [downloadName, setDownloadName] = useState("generated.png");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // TODO: POST to your Go API, then setPreviewSrc(URL.createObjectURL(...)) or base64 string
  
    const baseUrl: string = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8081"
    const url = new URL("generateimage",baseUrl)

    try {
      const requestBody = {
        positivePrompt,
        negativePrompt
      }
      
      const responseImage = await fetch(url.toString(), {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: {
          'Content-Type': 'application/json', 
        }
      })

      if (!responseImage.ok) throw new Error(`HTTP error! status: ${responseImage.status}`)
    
      const filename =
        parseFilename(responseImage.headers.get("content-disposition")) ??
        "generated.png";
      const blob = await responseImage.blob();
      const objectUrl = URL.createObjectURL(blob)
      setPreviewSrc(objectUrl);
      setDownloadName(filename);

    } catch (error) {
      return error
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
            <h1 className="text-3xl font-semibold">Image Prompts</h1>
            <p className="text-sm text-muted-foreground">
              Describe what you want and what to avoid.
            </p>
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

            <Button type="submit" className="w-full sm:w-auto">
              Generate
            </Button>
          </form>
        </section>

        <section className="w-full lg:w-1/2">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <AspectRatio ratio={1}>
              <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted">
                <img
                  src={previewSrc}
                  alt="Generated preview"
                  className="h-full w-full object-cover"
                />
              </div>
            </AspectRatio>
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
