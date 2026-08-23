// Atom: plakietka statusu linku podarunkowego.
//
// Kolor niesie ZNACZENIE, nie dekorację: zielony = link nadal otwiera artykuł,
// czerwony = dostęp odcięty ręcznie (ktoś cofnął), szary = link wygasł sam.
// Etykieta przychodzi GOTOWA propsem, więc atom nie zna ani słownika, ani
// języka - dokładnie jak ClubBadges w panelu klubów.
export function GiftStatusPill({
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
