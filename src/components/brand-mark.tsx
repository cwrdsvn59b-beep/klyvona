import mark from "@/assets/klyvona-mark.jpg";
import { cn } from "@/lib/cn";

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src={mark}
      alt=""
      className={cn(
        "h-16 w-16 rounded-2xl object-cover shadow-card outline outline-1 -outline-offset-1 outline-ink/10",
        className,
      )}
    />
  );
}
