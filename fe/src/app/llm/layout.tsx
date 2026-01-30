import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LLM Chat",
  description: "Stream and manage LLM conversations in TypeTerrors.",
};

export default function LlmLayout({ children }: { children: React.ReactNode }) {
  return children;
}
