"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProcessingStatusBadge } from "@/components/shared/processing-status-badge";

export default function TranscriptPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // US-ARC-04's "very long transcripts load progressively" AC — a fixed first page, not the
  // entire message history in one response, same cursor-pagination contract memories use.
  const { data } = useQuery({ queryKey: ["transcript", id], queryFn: () => api.transcript(id, { limit: 100 }) });

  if (!data) return null;
  const { conversation, messages } = data;

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
              <ProcessingStatusBadge status={conversation.status} />
            </div>
          </div>
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
    </div>
  );
}
