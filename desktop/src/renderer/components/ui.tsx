import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * The small set of primitives this app needs, in the dashboard's idiom.
 *
 * Deliberately not a port of the whole shadcn layer: the agent has four screens and no dialogs,
 * so copying a component library it does not use would be dead weight. What is here matches the
 * dashboard's shapes (radius, border, shadow, muted text) so the two read as one product.
 */

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-card)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-lg">{children}</h2>;
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm text-muted-foreground">{children}</p>;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'destructive';
};

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90',
  outline: 'border border-border bg-card hover:bg-secondary',
  ghost: 'hover:bg-secondary',
  destructive: 'bg-destructive text-destructive-foreground hover:opacity-90',
};

export function Button({ variant = 'primary', className = '', ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'success' | 'warning' }) {
  const tones = {
    muted: 'border-border text-muted-foreground',
    success: 'border-[color:var(--success)]/40 text-[color:var(--success)]',
    warning: 'border-tape/50 text-tape-foreground bg-tape/10',
  } as const;
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${tones[tone]}`}>{children}</span>
  );
}
