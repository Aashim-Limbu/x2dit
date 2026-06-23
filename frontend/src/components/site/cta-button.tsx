import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "glass" | "ghost";
type Size = "sm" | "md" | "lg";

// Rectangular, stamped controls — no pill, no glow. The primary reads like a
// rubber-stamped action; the secondary is an ink-outline form button.
const base =
  "relative inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] font-medium transition-all duration-[var(--dur-fast)] ease-[var(--ease-out-expo)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-disabled:pointer-events-none aria-disabled:opacity-50";

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[0.95rem]",
  lg: "h-12 px-6 text-base",
};

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-[var(--on-primary)] shadow-stamp hover:bg-primary-bright active:translate-y-px",
  // `glass` is the secondary ink-outline action (key kept for call-site stability).
  glass:
    "border border-[color-mix(in_oklch,var(--ink)_55%,transparent)] text-ink hover:bg-[var(--hover-tint)] hover:border-ink active:translate-y-px active:bg-[var(--active-tint)]",
  ghost:
    "text-muted-ink hover:bg-[var(--hover-tint)] hover:text-ink active:bg-[var(--active-tint)]",
};

type CommonProps = {
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
};

type LinkProps = CommonProps & {
  href: string;
  external?: boolean;
  onClick?: never;
  type?: never;
  loading?: never;
  disabled?: never;
};

type ButtonProps = CommonProps & {
  href?: undefined;
  onClick?: () => void;
  type?: "button" | "submit";
  loading?: boolean;
  disabled?: boolean;
  external?: never;
};

type Props = LinkProps | ButtonProps;

/**
 * Canonical CTA. Polymorphic: pass `href` for a Link/anchor, omit it for a real
 * `<button>` (used to drive the flow step machines). Variants share tokens,
 * token-shadows, and the single `--focus` ring. `loading` swaps in a spinner
 * (with `motion-reduce:animate-none`); the label keeps carrying meaning.
 */
export function CtaButton(props: Props) {
  const {
    children,
    variant = "primary",
    size = "md",
    className,
  } = props;
  const cls = cn(base, sizes[size], variants[variant], className);

  // Anchor / Link mode
  if (props.href !== undefined) {
    if (props.external) {
      return (
        <a
          href={props.href}
          target="_blank"
          rel="noopener noreferrer"
          className={cls}
        >
          {children}
        </a>
      );
    }
    return (
      <Link href={props.href} className={cls}>
        {children}
      </Link>
    );
  }

  // Button mode
  const { onClick, type = "button", loading, disabled } = props;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cls}
    >
      {loading && (
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      )}
      {children}
    </button>
  );
}
