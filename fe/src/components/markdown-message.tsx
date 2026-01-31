"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

import { cn } from "@/lib/utils";

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
            <pre {...props} className={cn("tt-codeblock", preClassName)} />
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
