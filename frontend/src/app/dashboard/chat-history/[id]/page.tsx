"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProcessingStatusBadge } from "@/components/shared/processing-status-badge";
import { ConversationActions } from "@/components/chat-history/conversation-actions";

const PAGE_SIZE = 100;

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // US-ARC-04 AC: "very long transcripts load progressively rather than freezing the page" — the
  // API has always paginated via a message-position cursor; this page previously called it once
  // with a fixed limit and no way to reach a second page, so a 400-message transcript silently
  // stopped at message 100 with no indication anything was missing.
  const transcript = useInfiniteQuery({
    queryKey: ["transcript", id],
    queryFn: ({ pageParam }) => api.transcript(id, { limit: PAGE_SIZE, cursor: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const messages = useMemo(() => transcript.data?.pages.flatMap((p) => p.messages) ?? [], [transcript.data]);
  const conversation = transcript.data?.pages[0]?.conversation;

  if (!conversation) return null;

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-4">
      <Button variant="ghost" size="sm" className="w-fit gap-1.5 text-muted-foreground" onClick={() => router.push("/dashboard/chat-history")}>
        <ArrowLeft className="h-4 w-4" />
        Back to conversations
      </Button>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">{conversation.title}</CardTitle>
            <div className="mt-1.5 flex items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {conversation.platform}
              </Badge>
              {conversation.status === "excluded" ? <Badge variant="outline">Excluded</Badge> : <ProcessingStatusBadge status={conversation.status} />}
            </div>
          </div>
          <ConversationActions
            conversation={conversation}
            onDeleted={() => router.push("/dashboard/chat-history")}
            onExcluded={() => router.push("/dashboard/chat-history")}
          />
        </CardHeader>
        {conversation.summary && (
          <CardContent className="border-t border-border pt-4 text-sm text-muted-foreground">
            {conversation.summary}
          </CardContent>
        )}
      </Card>

      <div className="flex flex-col gap-3">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
              message.role === "user"
                ? "self-end bg-primary text-primary-foreground"
                : "self-start border border-border bg-card"
            }`}
            style={{ contentVisibility: "auto", containIntrinsicSize: "0 80px" }}
          >
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide opacity-70">
              {message.role === "user" ? "You" : "Assistant"}
            </p>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        ))}
      </div>

      {transcript.hasNextPage && (
        <Button
          variant="outline"
          className="self-center"
          disabled={transcript.isFetchingNextPage}
          onClick={() => transcript.fetchNextPage()}
        >
          {transcript.isFetchingNextPage ? "Loading…" : "Load more messages"}
        </Button>
      )}
    </div>
  );
}
