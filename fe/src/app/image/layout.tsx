import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Image Studio",
  description: "Manage models, LoRAs, and generate images in TypeTerrors.",
};

export default function ImageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
