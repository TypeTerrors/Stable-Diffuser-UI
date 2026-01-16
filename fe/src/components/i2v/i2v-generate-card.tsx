"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PromptFields } from "@/components/prompt-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AlertCircle, Loader2 } from "lucide-react";

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function I2VGenerateCard({
  baseUrl,
  disabled,
}: {
  baseUrl: string;
  disabled: boolean;
}) {
  const url = useMemo(() => new URL("generateimagetovideo", baseUrl), [baseUrl]);

  const [positivePrompt, setPositivePrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [videoUrl, setVideoUrl] = useState<string>("");

  const previousUrlRef = useRef<string>("");

  useEffect(() => {
    previousUrlRef.current = videoUrl;
  }, [videoUrl]);

  useEffect(() => {
    return () => {
      if (previousUrlRef.current.startsWith("blob:")) URL.revokeObjectURL(previousUrlRef.current);
    };
  }, []);

  const generate = async () => {
    if (!file) {
      setStatus("Please upload an image first.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const payload = {
        positivePrompt,
        negativePrompt,
        image: base64FromBytes(bytes),
      };

      const resp = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const blob = await resp.blob();
      const objectUrl = URL.createObjectURL(blob);

      setVideoUrl((prev) => {
        if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
        return objectUrl;
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader>
        <CardTitle>Generate</CardTitle>
        <CardDescription>Upload an image, set prompts, then generate a short mp4 clip.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Input
            type="file"
            accept="image/*"
            disabled={disabled || busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? <p className="text-xs text-muted-foreground">Selected: {file.name}</p> : null}
        </div>

        <PromptFields
          positivePrompt={positivePrompt}
          negativePrompt={negativePrompt}
          onPositiveChange={setPositivePrompt}
          onNegativeChange={setNegativePrompt}
          disabled={disabled || busy}
        />

        {videoUrl ? (
          <div className="space-y-2">
            <video controls className="w-full rounded-lg border bg-muted" src={videoUrl} />
            <Button asChild variant="secondary" className="w-full">
              <a href={videoUrl} download="generated.mp4">
                Download mp4
              </a>
            </Button>
          </div>
        ) : null}
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-3">
        <Button type="button" onClick={generate} disabled={disabled || busy || !file}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Generate video
        </Button>

        {status ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Request failed</AlertTitle>
            <AlertDescription>{status}</AlertDescription>
          </Alert>
        ) : null}
      </CardFooter>
    </Card>
  );
}

