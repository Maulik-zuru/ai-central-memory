"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { type KnowledgeGraph } from "@/lib/api";
import { Badge } from "@/components/ui/badge";

const WIDTH = 640;
const HEIGHT = 420;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
const RADIUS = Math.min(WIDTH, HEIGHT) / 2 - 48;

interface PositionedNode {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
}

// SVG + a deterministic circular layout, not force-directed physics — resolves
// Frontend_Plan.md §8's open rendering-strategy question for this phase's actual scale target
// ("a few hundred nodes," per the PRD's own AC): real DOM nodes stay focusable and
// screen-reader labelable, which a canvas/WebGL graph would not be (Phase9_Implementation_Plan.md §6.2).
export function GraphExplorer({ graph }: { graph: KnowledgeGraph }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const positioned = useMemo<PositionedNode[]>(() => {
    const count = graph.nodes.length;
    return graph.nodes.map((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(count, 1) - Math.PI / 2;
      return {
        ...node,
        x: CENTER_X + RADIUS * Math.cos(angle),
        y: CENTER_Y + RADIUS * Math.sin(angle),
      };
    });
  }, [graph.nodes]);

  const nodeById = useMemo(() => new Map(positioned.map((n) => [n.id, n])), [positioned]);
  const selectedNode = selectedId ? nodeById.get(selectedId) : null;
  const connectedEdges = selectedId
    ? graph.edges.filter((e) => e.fromNodeId === selectedId || e.toNodeId === selectedId)
    : [];

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-6 py-20 text-center">
        <p className="text-sm text-muted-foreground">
          No connections yet — the extraction job runs hourly over your memories and conversations. Check back after
          it's had a chance to run.
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      <svg
        role="img"
        aria-label="Knowledge graph of connected entities"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="flex-1 rounded-xl border border-border bg-card"
      >
        {graph.edges.map((edge) => {
          const from = nodeById.get(edge.fromNodeId);
          const to = nodeById.get(edge.toNodeId);
          if (!from || !to) return null;
          const dimmed = selectedId && edge.fromNodeId !== selectedId && edge.toNodeId !== selectedId;
          return (
            <line
              key={edge.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="currentColor"
              className={dimmed ? "text-border" : "text-muted-foreground"}
              strokeWidth={1.5}
            />
          );
        })}
        {positioned.map((node) => (
          <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
            <circle
              r={selectedId === node.id ? 10 : 7}
              className={
                selectedId === node.id
                  ? "cursor-pointer fill-primary"
                  : "cursor-pointer fill-secondary stroke-border"
              }
              strokeWidth={1}
              tabIndex={0}
              role="button"
              aria-label={`${node.name} (${node.type})`}
              onClick={() => setSelectedId(node.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setSelectedId(node.id);
              }}
            />
            <text
              y={-14}
              textAnchor="middle"
              className="fill-foreground text-[10px]"
              style={{ pointerEvents: "none" }}
            >
              {node.name}
            </text>
          </g>
        ))}
      </svg>

      <aside className="w-64 shrink-0 rounded-xl border border-border bg-card p-4">
        {selectedNode ? (
          <div className="flex flex-col gap-3">
            <div>
              <Badge variant="secondary">{selectedNode.type}</Badge>
              <h3 className="mt-2 text-base font-semibold">{selectedNode.name}</h3>
            </div>
            <div className="flex flex-col gap-2">
              {connectedEdges.length === 0 && (
                <p className="text-sm text-muted-foreground">No connections recorded yet.</p>
              )}
              {connectedEdges.map((edge) => {
                const other = nodeById.get(edge.fromNodeId === selectedNode.id ? edge.toNodeId : edge.fromNodeId);
                return (
                  <div key={edge.id} className="rounded-lg border border-border/60 p-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">{edge.label}</span> {other?.name ?? "unknown"}
                    </p>
                    {edge.sourceMemoryId ? (
                      <Link href={`/dashboard/memories/${edge.sourceMemoryId}`} className="text-xs text-primary underline">
                        View source memory
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">Source: a past conversation</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click a node to see how it connects and where it came from.</p>
        )}
      </aside>
    </div>
  );
}
