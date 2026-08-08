import { type LucideIcon } from "lucide-react";

// Styled like an index card waiting to be filled in — dashed rule, a small mono "phase" label
// pinned in the corner like a tab — rather than a generic dashboard placeholder.
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
    <div className="relative flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card/60 px-6 py-24 text-center">
      {eta && (
        <span className="mono-tag absolute right-5 top-5 rounded-full border border-border bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
          {eta}
        </span>
      )}
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
        <Icon className="h-5 w-5 text-accent-foreground" strokeWidth={1.75} />
      </div>
      <h2 className="text-xl">{title}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
