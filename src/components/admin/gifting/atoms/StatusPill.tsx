// Atom: pigulka statusu linku prezentowego.

export function StatusPill({
  status,
  label,
}: {
  status: "active" | "revoked" | "expired";
  label: string;
}) {
  const cls =
    status === "active"
      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
      : status === "revoked"
        ? "bg-destructive/10 text-destructive border-destructive/20"
        : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center h-6 px-2 rounded-[6px] border text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}
