"use client";

import type { useHomeController } from "@/app/_home/useHomeController";
import { PromptFields } from "@/components/prompt-fields";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Loader2 } from "lucide-react";

type HomeController = ReturnType<typeof useHomeController>;

export function T2IPromptsCard({ controller }: { controller: HomeController }) {
  const {
    busy,
    status,
    positivePrompt,
    setPositivePrompt,
    negativePrompt,
    setNegativePrompt,
    handleSubmit,
  } = controller;

  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader>
        <CardTitle>Prompts</CardTitle>
        <CardDescription>Generate uses the currently applied model and LoRAs.</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-3">
          <PromptFields
            positivePrompt={positivePrompt}
            negativePrompt={negativePrompt}
            onPositiveChange={setPositivePrompt}
            onNegativeChange={setNegativePrompt}
            disabled={busy !== null}
          />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" disabled={busy !== null}>
            {busy === "generate" ? <Loader2 className="animate-spin" /> : null}
            Generate
          </Button>

          {status ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Request failed</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          ) : null}
        </CardFooter>
      </form>
    </Card>
  );
}

