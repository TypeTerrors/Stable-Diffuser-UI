"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, Loader2 } from "lucide-react";

import type { BusyState } from "@/app/_home/types";

type Props = {
  busy: BusyState;
  status: string;
  positivePrompt: string;
  negativePrompt: string;
  onChangePositive: (value: string) => void;
  onChangeNegative: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
};

export function PromptsCard({
  busy,
  status,
  positivePrompt,
  negativePrompt,
  onChangePositive,
  onChangeNegative,
  onSubmit,
}: Props) {
  return (
    <Card className="border-muted-foreground/10 shadow-sm">
      <CardHeader>
        <CardTitle>Prompts</CardTitle>
        <CardDescription>Generate uses the currently applied model and LoRAs.</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-3">
          <Textarea placeholder="Positive prompt..." value={positivePrompt} onChange={(e) => onChangePositive(e.target.value)} rows={5} />
          <Textarea placeholder="Negative prompt..." value={negativePrompt} onChange={(e) => onChangeNegative(e.target.value)} rows={3} />
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-3">
          <Button type="submit" disabled={busy !== null}>
            {busy === "generate" ? <Loader2 className="animate-spin" /> : null}
            Generate
          </Button>

          {status && (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Request failed</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          )}
        </CardFooter>
      </form>
    </Card>
  );
}
