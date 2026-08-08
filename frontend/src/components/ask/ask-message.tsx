"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { type AskMessage as AskMessageType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { CitationChip } from "./citation-chip";

export function AskMessageBubble({ message }: { message: AskMessageType }) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  return (
    <div className={`flex flex-col gap-2 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? "bg-primary text-primary-foreground" : "border border-border bg-card"
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>

      {!isUser && (
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground"
            title="Copy answer text (citations not included)"
            onClick={() => {
              navigator.clipboard.writeText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}

      {!isUser && message.citations && message.citations.length > 0 && (
        <div className="grid w-full max-w-[85%] grid-cols-1 gap-2 sm:grid-cols-2">
          {message.citations.map((citation, i) => (
            <CitationChip key={i} citation={citation} />
          ))}
        </div>
      )}
    </div>
  );
}
