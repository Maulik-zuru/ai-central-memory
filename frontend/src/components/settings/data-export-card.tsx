"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { api, downloadExportArchive, type DataExportRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_VARIANT = {
  queued: "outline",
  running: "outline",
  complete: "success",
  failed: "destructive",
} as const;

function isExpired(request: DataExportRequest): boolean {
  return Boolean(request.expiresAt && new Date(request.expiresAt).getTime() <= Date.now());
}

export function DataExportCard() {
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["exports"],
    queryFn: api.exports,
    // An export runs in the background; poll while any request is still in flight so the status
    // badge reflects reality without the user reloading the page.
    refetchInterval: (query) =>
      query.state.data?.exports.some((e) => e.status === "queued" || e.status === "running") ? 2000 : false,
  });

  const request = useMutation({
    mutationFn: api.requestExport,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["exports"] }),
  });

  const exports = data?.exports ?? [];

  async function download(id: string) {
    setDownloadError(null);
    try {
      await downloadExportArchive(id);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : "Download failed");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export your data</CardTitle>
        <CardDescription>
          A complete copy of your memories, buckets, conversations, Ask threads, and file details as
          JSON. Download links stay valid for 7 days.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Button
          size="sm"
          className="self-start gap-2"
          onClick={() => request.mutate()}
          disabled={request.isPending}
        >
          <RefreshCw className={`h-4 w-4 ${request.isPending ? "animate-spin" : ""}`} />
          {request.isPending ? "Requesting…" : "Request export"}
        </Button>

        {downloadError && <p className="text-sm text-destructive">{downloadError}</p>}

        {exports.length > 0 && (
          <div className="flex flex-col divide-y divide-border">
            {exports.map((request) => {
              const expired = isExpired(request);
              return (
                <div key={request.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">Requested {new Date(request.requestedAt).toLocaleString()}</p>
                    {request.status === "failed" && (
                      <p className="text-xs text-destructive">
                        {request.errorReason ?? "Export failed"} — request a new export to try again.
                      </p>
                    )}
                    {request.status === "complete" && expired && (
                      <p className="text-xs text-muted-foreground">
                        This link has expired. Request a new export to download again.
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={STATUS_VARIANT[request.status]} className="capitalize">
                      {request.status}
                    </Badge>
                    {request.status === "complete" && !expired && (
                      <Button size="sm" variant="outline" className="gap-2" onClick={() => download(request.id)}>
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
