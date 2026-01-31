"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { LlmModelPicker } from "@/components/llm-model-picker";
import { MarkdownMessage } from "@/components/markdown-message";
import { AlertCircle, Loader2, RefreshCw, Send, Square } from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
};

type WsConversationPayload = {
  username?: string;
  error?: string;
  message?: string;
  ping?: string;
};

type ConnectionState = "idle" | "connecting" | "connected" | "disconnected" | "error";

const MAX_RECONNECT_DELAY_MS = 10000;

function decodeBase64Text(value: string): string {
  if (!value) return "";
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
}

export default function LlmPage() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [busy, setBusy] = useState(false);
  const [stopBusy, setStopBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectToken, setReconnectToken] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const streamIdleTimer = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const manualReconnectRef = useRef(false);
  const allowReconnectRef = useRef(true);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";
  const wsBase = useMemo(() => {
    if (baseUrl.startsWith("https://")) return baseUrl.replace(/^https:\/\//, "wss://");
    return baseUrl.replace(/^http:\/\//, "ws://");
  }, [baseUrl]);
  const conversationUrl = useMemo(() => new URL("conversation", baseUrl), [baseUrl]);
  const stopUrl = useMemo(() => new URL("conversation/stop", baseUrl), [baseUrl]);

  const [llmModelError, setLlmModelError] = useState("");
  const [currentLlmModelId, setCurrentLlmModelId] = useState("");

  const params = useParams();
  const rawUsername = params?.username;
  const username =
    typeof rawUsername === "string"
      ? rawUsername.trim()
      : Array.isArray(rawUsername)
        ? rawUsername[0]?.trim() ?? ""
        : "";

  useEffect(() => {
    if (typeof window === "undefined" || !username) return;
    window.sessionStorage.setItem("tt.username", username);
  }, [username]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.sessionStorage.getItem("tt.llmModelId") ?? "";
    if (existing) setCurrentLlmModelId(existing);
  }, []);

  const scheduleReconnect = useCallback((opts?: { immediate?: boolean }) => {
    if (!username || !allowReconnectRef.current) return;
    if (reconnectTimerRef.current) return;
    const attempt = reconnectAttemptsRef.current + 1;
    reconnectAttemptsRef.current = attempt;
    const backoff = Math.min(1000 * 2 ** (attempt - 1), MAX_RECONNECT_DELAY_MS);
    const jitter = Math.floor(Math.random() * 400);
    const delay = opts?.immediate ? 0 : backoff + jitter;
    setReconnecting(true);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      setReconnectToken((prev) => prev + 1);
    }, delay);
  }, [username]);

  useEffect(() => {
    if (!username) return;

    allowReconnectRef.current = true;
    setConnection("connecting");
    setErrorMessage("");

    const wsUrl = new URL(`conversation/${encodeURIComponent(username)}`, wsBase);
    const ws = new WebSocket(wsUrl.toString());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnection("connected");
      reconnectAttemptsRef.current = 0;
      setReconnecting(false);
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      let payload: WsConversationPayload | null = null;
      try {
        payload = JSON.parse(String(event.data)) as WsConversationPayload;
      } catch {
        return;
      }

      if (!payload) return;
      if (payload.ping) return;

      if (payload.error) {
        setErrorMessage(payload.error);
        setConnection("error");
        return;
      }

      if (!payload.message) return;

      const token = decodeBase64Text(payload.message);
      if (!token) return;

      setMessages((prev) => {
        const activeId = activeAssistantIdRef.current;
        if (!activeId) return prev;
        return prev.map((msg) => (msg.id === activeId ? { ...msg, content: msg.content + token } : msg));
      });

      setStreaming(true);
      if (streamIdleTimer.current) window.clearTimeout(streamIdleTimer.current);
      streamIdleTimer.current = window.setTimeout(() => setStreaming(false), 1200);
    };

    ws.onerror = () => {
      setConnection("error");
      if (manualReconnectRef.current) return;
      scheduleReconnect();
    };

    ws.onclose = () => {
      setConnection("disconnected");
      setStreaming(false);
      if (manualReconnectRef.current) {
        manualReconnectRef.current = false;
        scheduleReconnect({ immediate: true });
        return;
      }
      scheduleReconnect();
    };

    return () => {
      allowReconnectRef.current = false;
      wsRef.current = null;
      ws.close();
    };
  }, [username, wsBase, reconnectToken, scheduleReconnect]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streaming]);

  useEffect(() => {
    return () => {
      if (streamIdleTimer.current) window.clearTimeout(streamIdleTimer.current);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
    };
  }, []);

  const pushMessage = (message: ChatMessage) => {
    setMessages((prev) => [...prev, message]);
  };

  const handleSubmit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (!input.trim() || !username || busy) return;

    if (connection !== "connected") {
      setErrorMessage("WebSocket is not connected yet. Please wait for the connection.");
      return;
    }

    const userText = input.trim();
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: userText,
      timestamp: Date.now(),
    };

    const assistantMessage: ChatMessage = {
      id: `${Date.now()}-assistant`,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };

    setInput("");
    setErrorMessage("");
    pushMessage(userMessage);
    pushMessage(assistantMessage);
    activeAssistantIdRef.current = assistantMessage.id;
    setStreaming(true);

    setBusy(true);
    try {
      const resp = await fetch(conversationUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, prompt: userText }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || `HTTP ${resp.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start conversation.";
      setErrorMessage(message);
      setStreaming(false);
      setMessages((prev) =>
        prev.map((msg) => (msg.id === assistantMessage.id ? { ...msg, content: `Error: ${message}` } : msg))
      );
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const clearChat = () => {
    setMessages([]);
    activeAssistantIdRef.current = null;
    setStreaming(false);
  };

  const handleReconnect = () => {
    if (!username) return;
    manualReconnectRef.current = true;
    reconnectAttemptsRef.current = 0;
    setErrorMessage("");
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
      wsRef.current.close();
      return;
    }
    scheduleReconnect({ immediate: true });
  };

  const handleStop = async () => {
    if (!username || stopBusy) return;
    setStopBusy(true);
    setErrorMessage("");
    try {
      const resp = await fetch(stopUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(text || `HTTP ${resp.status}`);
      }
      setStreaming(false);
      activeAssistantIdRef.current = null;
      pushMessage({
        id: `${Date.now()}-system`,
        role: "system",
        content: "Stream cancelled.",
        timestamp: Date.now(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stop the stream.";
      setErrorMessage(message);
    } finally {
      setStopBusy(false);
    }
  };

  const connectionBadge = () => {
    switch (connection) {
      case "connected":
        return { label: "Connected", variant: "secondary" as const };
      case "connecting":
        return { label: "Connecting", variant: "outline" as const };
      case "error":
        return { label: "Error", variant: "destructive" as const };
      case "disconnected":
        return { label: "Disconnected", variant: "outline" as const };
      default:
        return { label: "Idle", variant: "outline" as const };
    }
  };

  const { label: connectionLabel, variant: connectionVariant } = connectionBadge();
  const canStop = streaming || busy;

  return (
    <main className="min-h-screen bg-gradient-to-b from-muted/50 to-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <nav className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Home</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/image">Image Studio</Link>
          </Button>
          <Button variant="secondary" size="sm" disabled>
            LLM Chat
          </Button>
        </nav>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <header className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">TypeTerrors</p>
            <h1 className="text-3xl font-semibold tracking-tight">LLM Conversation</h1>
            <p className="text-sm text-muted-foreground">Ask questions and stream answers from the inference server.</p>
          </header>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={connectionVariant}>{connectionLabel}</Badge>
            {streaming ? (
              <Badge variant="outline" className="gap-1">
                <Loader2 className="size-3 animate-spin" />
                Streaming
              </Badge>
            ) : null}
            <LlmModelPicker
              apiBaseUrl={baseUrl}
              value={currentLlmModelId}
              onChange={(next) => {
                setCurrentLlmModelId(next);
                if (typeof window !== "undefined") window.sessionStorage.setItem("tt.llmModelId", next);
              }}
              onErrorChange={setLlmModelError}
            />
            <Button variant="outline" size="sm" onClick={handleReconnect} className="gap-2">
              <RefreshCw className={cn("size-4", reconnecting ? "animate-spin" : "")} />
              {reconnecting ? "Reconnecting" : "Reconnect"}
            </Button>
            <Button variant="outline" size="sm" onClick={handleStop} disabled={!canStop || stopBusy} className="gap-2">
              {stopBusy ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
              Stop
            </Button>
            <Button variant="outline" size="sm" onClick={clearChat} disabled={messages.length === 0}>
              Clear chat
            </Button>
          </div>
        </div>

        {errorMessage ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Connection issue</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {llmModelError ? (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertTitle>Model selection issue</AlertTitle>
            <AlertDescription>{llmModelError}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="border-muted-foreground/10 shadow-sm">
          <CardHeader className="space-y-1">
            <CardTitle>Conversation</CardTitle>
            <CardDescription>
              Messages stream from the backend WebSocket. Your session id is {username || "pending"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ScrollArea className="h-[60vh] rounded-lg border bg-background/70">
              <div className="flex flex-col gap-4 p-4">
                {messages.length === 0 ? (
                  <div className="rounded-lg border border-dashed bg-muted/40 p-6 text-sm text-muted-foreground">
                    Start a conversation by sending a prompt below. Responses will appear here as they stream in.
                  </div>
                ) : (
                  messages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        "flex w-full flex-col gap-1",
                        message.role === "user" ? "items-end" : "items-start"
                      )}
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        {message.role === "user" ? "You" : message.role === "assistant" ? "Assistant" : "System"}
                      </span>
                      <div
                        className={cn(
                          "max-w-[80%] break-words rounded-2xl px-4 py-3 text-sm shadow-sm",
                          message.role === "user"
                            ? "bg-primary text-primary-foreground whitespace-pre-wrap"
                            : message.role === "assistant"
                              ? "bg-muted"
                              : "bg-destructive/10 text-destructive"
                        )}
                      >
                        {message.role === "user" ? (
                          message.content
                        ) : (
                          <MarkdownMessage
                            markdown={message.content || (message.role === "assistant" && streaming ? "…" : "")}
                            className={message.role === "assistant" ? "text-foreground" : undefined}
                          />
                        )}
                      </div>
                    </div>
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <Separator />

            <form onSubmit={handleSubmit} className="space-y-3">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the model anything…"
                className="min-h-[120px] resize-none"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">Press Enter to send, Shift + Enter for a new line.</p>
                <Button type="submit" className="gap-2" disabled={!input.trim() || busy || connection !== "connected"}>
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Send
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
