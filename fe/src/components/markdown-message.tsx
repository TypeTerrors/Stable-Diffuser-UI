"use client";

import React, { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

function extractText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

function CodeBlock({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLPreElement>) {
  const codeText = useMemo(() => extractText(children), [children]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!codeText) return;
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [codeText]);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-2 top-2 z-10 h-7 gap-1.5 px-2 text-[11px]"
        onClick={handleCopy}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
        {copied ? "Copied" : "Copy"}
      </Button>
      <pre {...props} className={cn("tt-codeblock pt-10", className)}>
        {children}
      </pre>
    </div>
  );
}

export function MarkdownMessage({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div className={cn("tt-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ className: aClassName, ...props }) => (
            <a
              {...props}
              className={cn("underline underline-offset-2 hover:opacity-90", aClassName)}
              target={props.href?.startsWith("#") ? undefined : "_blank"}
              rel={props.href?.startsWith("#") ? undefined : "noreferrer"}
            />
          ),
          pre: ({ className: preClassName, ...props }) => (
            <CodeBlock {...props} className={preClassName} />
          ),
          code: ({ className: codeClassName, children, ...props }) => {
            const { inline, ...rest } = props as { inline?: boolean };
            const isInline = Boolean(inline);
            return (
              <code
                {...rest}
                className={cn(isInline ? "tt-inline-code" : "tt-codeblock-code", codeClassName)}
              >
                {children}
              </code>
            );
          },
          table: ({ className: tableClassName, ...props }) => (
            <div className="tt-table-wrap">
              <table {...props} className={cn("tt-table", tableClassName)} />
            </div>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
