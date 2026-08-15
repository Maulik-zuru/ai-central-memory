"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Sparkles } from "lucide-react";
import { api, type FileAskResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ProcessingStatusBadge } from "@/components/shared/processing-status-badge";

export default function FileDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [jumpedPage, setJumpedPage] = useState<number | null>(null);

  const fileQuery = useQuery({
    queryKey: ["file", id],
    queryFn: () => api.file(id),
    // Same poll-while-in-flight convention as the files list (files/page.tsx) and the account
    // export card (data-export-card.tsx) — otherwise a file sitting on this exact page never
    // notices processing finished until it's manually reloaded.
    refetchInterval: (q) => (q.state.data?.file.status === "processing" ? 2000 : false),
  });
  const ask = useMutation<FileAskResult, unknown, void>({ mutationFn: () => api.askFile(id, question) });

  if (!fileQuery.data) return null;
  const { file } = fileQuery.data;

  return (
    <div className="flex max-w-2xl flex-1 flex-col gap-4">
      <Button variant="ghost" size="sm" className="w-fit gap-1.5 text-muted-foreground" onClick={() => router.push("/dashboard/files")}>
        <ArrowLeft className="h-4 w-4" />
        Back to files
      </Button>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{file.filename}</CardTitle>
          <ProcessingStatusBadge status={file.status} />
        </CardHeader>
        {file.status === "error" && (
          <CardContent className="border-t border-border pt-4 text-sm text-destructive">{file.errorReason}</CardContent>
        )}
      </Card>

      {file.status === "ready" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ask this file</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What's the termination period?"
            />
            <Button
              size="sm"
              className="w-fit gap-2"
              disabled={!question.trim() || ask.isPending}
              onClick={() => ask.mutate()}
            >
              <Sparkles className="h-4 w-4" />
              {ask.isPending ? "Thinking…" : "Ask"}
            </Button>

            {ask.isError && (
              <Alert variant="destructive">
                {ask.error instanceof Error ? ask.error.message : "Could not get an answer right now. Try again."}
              </Alert>
            )}

            {ask.data && (
              <div className="mt-2 flex flex-col gap-3 rounded-lg border border-border bg-secondary/40 p-4">
                <p className="text-sm text-foreground">{ask.data.answer}</p>
                {ask.data.citations.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Citations</p>
                    {ask.data.citations.map((citation, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setJumpedPage(citation.page)}
                        className="flex flex-col items-start gap-1 rounded-lg border border-border bg-card p-3 text-left text-xs hover:border-primary"
                      >
                        <Badge variant="outline">Page {citation.page}</Badge>
                        <span className="text-muted-foreground">{citation.excerpt}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {jumpedPage !== null && (
              <div className="rounded-lg border border-primary bg-accent p-3 text-sm">
                Jumped to page {jumpedPage} — full in-browser PDF preview lands in a later phase; this is the exact
                cited passage above.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
