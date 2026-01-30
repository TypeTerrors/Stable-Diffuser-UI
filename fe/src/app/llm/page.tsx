"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LlmIndexPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = "tt.username";
    const existing = window.sessionStorage.getItem(key);
    const username = existing
      ? existing
      : typeof crypto !== "undefined" && "randomUUID" in crypto
        ? `user-${crypto.randomUUID()}`
        : `user-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (!existing) window.sessionStorage.setItem(key, username);

    router.replace(`/llm/${encodeURIComponent(username)}`);
  }, [router]);

  return null;
}
