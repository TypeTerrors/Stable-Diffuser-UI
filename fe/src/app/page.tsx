import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 to-background text-foreground">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6 lg:px-8">
        <header className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">TypeTerrors</p>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Choose a workflow.</p>
        </header>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card className="border-muted-foreground/10 shadow-sm">
            <CardHeader>
              <CardTitle>Text to image</CardTitle>
              <CardDescription>Manage SDXL models + LoRAs and generate images.</CardDescription>
            </CardHeader>
            <CardContent />
            <CardFooter>
              <Button asChild className="w-full">
                <Link href="/t2i">Open</Link>
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-muted-foreground/10 shadow-sm">
            <CardHeader>
              <CardTitle>Image to video</CardTitle>
              <CardDescription>Set an LTX model, upload an image, and generate an mp4 clip.</CardDescription>
            </CardHeader>
            <CardContent />
            <CardFooter>
              <Button asChild className="w-full">
                <Link href="/i2v">Open</Link>
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </main>
  );
}

