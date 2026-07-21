import { cn } from "@/lib/utils";

interface InfoRowProps {
  label: string;
  value: string;
  /** Render the value in a monospace font (used for ids). */
  mono?: boolean;
}

/** Atom: a label/value line in the info panel, with the value truncated. */
export function InfoRow({ label, value, mono }: InfoRowProps) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn("text-right truncate max-w-[65%]", mono && "font-mono text-[10px]")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
