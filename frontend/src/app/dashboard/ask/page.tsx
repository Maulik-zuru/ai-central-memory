"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, MessageSquarePlus } from "lucide-react";
import { api, type AskMode } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AskMessageBubble } from "@/components/ask/ask-message";

const MODES: { value: AskMode; label: string }[] = [
  { value: "all", label: "All" },
  { value: "memories", label: "Memories" },
  { value: "chat_history", label: "Chat History" },
  { value: "files", label: "Files" },
];

export default function AskPage() {
  const queryClient = useQueryClient();
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [mode, setMode] = useState<AskMode>("all");
  const [bucketId, setBucketId] = useState<string | undefined>(undefined);
  const [question, setQuestion] = useState("");

  const threads = useQuery({ queryKey: ["ask-threads"], queryFn: () => api.askThreads({ limit: 30 }) });
  const buckets = useQuery({ queryKey: ["buckets"], queryFn: api.buckets });
  const activeThread = useQuery({
    queryKey: ["ask-thread", activeThreadId],
    queryFn: () => api.askThread(activeThreadId!),
    enabled: !!activeThreadId,
  });

  const ask = useMutation({
    mutationFn: () => api.ask({ conversationId: activeThreadId ?? undefined, question, mode, bucketId }),
    onSuccess: (result) => {
      setActiveThreadId(result.conversationId);
      setQuestion("");
      queryClient.invalidateQueries({ queryKey: ["ask-threads"] });
      queryClient.invalidateQueries({ queryKey: ["ask-thread", result.conversationId] });
    },
  });

  const messages = activeThread.data?.conversation.messages ?? [];

  return (
    <div className="flex flex-1 gap-6">
      <aside className="flex w-64 shrink-0 flex-col gap-2">
        <Button
          size="sm"
          variant="outline"
          className="w-full gap-2"
          onClick={() => {
            setActiveThreadId(null);
            setQuestion("");
          }}
        >
          <MessageSquarePlus className="h-4 w-4" />
          New question
        </Button>
        <div className="flex flex-col gap-1 overflow-y-auto">
          {threads.data?.items.map((thread) => (
            <button
              key={thread.id}
              onClick={() => setActiveThreadId(thread.id)}
              className={`truncate rounded-lg px-3 py-2 text-left text-sm ${
                activeThreadId === thread.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-accent"
              }`}
            >
              {thread.title}
            </button>
          ))}
        </div>
      </aside>

      <div className="flex flex-1 flex-col gap-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 px-6 py-24 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
              <Sparkles className="h-5 w-5 text-accent-foreground" strokeWidth={1.75} />
            </div>
            <h2 className="text-xl">Ask across everything you've saved</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              One question, answered by whichever of your memories, past chats, and documents are relevant — with
              clickable sources.
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
            {messages.map((message) => (
              <AskMessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-lg bg-secondary p-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                    mode === m.value ? "bg-card shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {buckets.data && buckets.data.buckets.length > 0 && (
              <select
                value={bucketId ?? ""}
                onChange={(e) => setBucketId(e.target.value || undefined)}
                className="h-7 rounded-md border border-input bg-card px-2 text-xs text-muted-foreground"
              >
                <option value="">All buckets</option>
                {buckets.data.buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && question.trim() && !ask.isPending) {
                  e.preventDefault();
                  ask.mutate();
                }
              }}
              placeholder="Ask a question across your memories, chats, and files…"
              className="flex-1"
            />
            <Button disabled={!question.trim() || ask.isPending} onClick={() => ask.mutate()}>
              {ask.isPending ? "Thinking…" : "Ask"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
