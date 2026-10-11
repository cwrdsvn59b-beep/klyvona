import { cn } from "@/lib/cn";
import { statusLabel, toneFor } from "@/lib/labels";

const tones = {
  primary: "bg-primary-soft text-primary",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  ok: "bg-ok-soft text-ok",
  muted: "bg-line text-muted",
};

export function StatusPill({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full px-3 text-sm font-medium",
        tones[toneFor(code)],
        className,
      )}
    >
      {statusLabel(code)}
    </span>
  );
}
