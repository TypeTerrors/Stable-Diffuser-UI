import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Bot, ImageIcon, MoveRight } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 to-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6 lg:px-8">
        <header className="space-y-3">
          <Badge variant="secondary" className="w-fit">
            TypeTerrors Studio
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Choose your workflow</h1>
          <p className="max-w-2xl text-base text-muted-foreground">
            Jump into image generation or start an LLM conversation. Both experiences stream responses from the backend so
            you can iterate fast.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="border-muted-foreground/10 shadow-sm">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
                <ImageIcon className="size-4" />
                Image Generation
              </div>
              <CardTitle className="text-2xl">Model + LoRA Studio</CardTitle>
              <CardDescription>
                Configure models, layer LoRAs, and generate images with prompt controls and download history.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link href="/image">
                  Open Image Studio
                  <MoveRight className="size-4" />
                </Link>
              </Button>
              <Badge variant="outline">Streaming updates</Badge>
            </CardContent>
          </Card>

          <Card className="border-muted-foreground/10 shadow-sm">
            <CardHeader className="space-y-2">
              <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
                <Bot className="size-4" />
                LLM Chat
              </div>
              <CardTitle className="text-2xl">Conversation Workspace</CardTitle>
              <CardDescription>
                Ask questions, review streamed responses, and keep a focused chat history in one place.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="gap-2">
                <Link href="/llm">
                  Open LLM Chat
                  <MoveRight className="size-4" />
                </Link>
              </Button>
              <Badge variant="outline">WebSocket stream</Badge>
            </CardContent>
          </Card>
        </div>

        <Separator />

        <section className="grid gap-6 md:grid-cols-3">
          <Card className="border-muted-foreground/10">
            <CardHeader>
              <CardTitle className="text-lg">Realtime feedback</CardTitle>
              <CardDescription>View streamed updates as the backend produces tokens or images.</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-muted-foreground/10">
            <CardHeader>
              <CardTitle className="text-lg">Session-aware</CardTitle>
              <CardDescription>Each browser session keeps its own WebSocket identity for routing responses.</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-muted-foreground/10">
            <CardHeader>
              <CardTitle className="text-lg">Built on shadcn/ui</CardTitle>
              <CardDescription>Consistent components and styling across the entire workspace.</CardDescription>
            </CardHeader>
          </Card>
        </section>
      </div>
    </main>
  );
}
