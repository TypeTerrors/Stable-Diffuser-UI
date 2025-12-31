import Link from "next/link";
import { ArrowRight, Image as ImageIcon, Video as VideoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Choose a generator</h1>
          <p className="text-sm text-muted-foreground">
            Pick a workflow, then generate an image or a video.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" />
                  <h2 className="text-lg font-semibold">Text to Image</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Enter positive/negative prompts and preview the generated image.
                </p>
              </div>
              <Button asChild className="shrink-0">
                <Link href="/text-to-image">
                  Open <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-6 shadow-sm">
            <div className="flex items-start justify-between gap-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <VideoIcon className="h-5 w-5" />
                  <h2 className="text-lg font-semibold">Image to Video</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Upload an image, add prompts, and preview the generated video.
                </p>
              </div>
              <Button asChild className="shrink-0">
                <Link href="/image-to-video">
                  Open <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

