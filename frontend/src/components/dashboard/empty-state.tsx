import { type LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  eta,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  eta?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-24 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      {eta && (
        <span className="mono-tag rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{eta}</span>
      )}
    </div>
  );
}
