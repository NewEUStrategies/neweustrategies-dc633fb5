// Atom: chip wyboru w edytorze targetingu slotu reklamowego.
//
// Wyjęty z `routes/admin.ads.tsx`, gdzie DOKŁADNIE ten sam markup stał TRZY
// razy (kategorie, tagi, wersje językowe) - trzy kopie tej samej decyzji
// dostępnościowej: stan wyboru jest ogłoszony przez `aria-pressed`, a nie
// wyłącznie kolorem tła. Kopia numer cztery (nowa grupa chipów) miałaby szansę
// zgubić `aria-pressed` bez żadnego sygnału w recenzji.
//
// Atom NIE zna ani i18n, ani Supabase: dostaje gotową etykietę propsem.

/** Klasy chipa - `active` jest nośnikiem znaczenia, nie dekoracją. */
export function adChipClass(active: boolean): string {
  return (
    "rounded-full border px-2.5 py-1 text-xs transition " +
    (active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-background hover:bg-muted")
  );
}

export function AdTargetingChip({
  label,
  active,
  onToggle,
}: {
  label: string;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onToggle} className={adChipClass(active)}>
      {label}
    </button>
  );
}
