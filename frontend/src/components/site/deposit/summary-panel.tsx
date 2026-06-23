import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type SummaryRow = {
  label: string;
  value: React.ReactNode;
};

type Props = {
  rows: SummaryRow[];
  className?: string;
};

/**
 * A glass summary panel (one of the four sanctioned glass uses). Each row is a
 * confirmed Check fact. Glass = .glass-surface (blur 16px) — defined once.
 */
export function SummaryPanel({ rows, className }: Props) {
  return (
    <dl
      className={cn(
        "glass-surface flex flex-col gap-3 rounded-2xl p-5 text-left text-sm",
        className,
      )}
    >
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-4">
          <dt className="flex items-center gap-2 text-muted-ink">
            <Check className="size-4 shrink-0 text-success" aria-hidden />
            {row.label}
          </dt>
          <dd className="text-right font-mono text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
