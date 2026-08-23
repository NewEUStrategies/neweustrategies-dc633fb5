// Atom: przycisk filtra w panelu gifting (linki i audyt).
//
// Przed ekstrakcją ten sam markup stał w dwóch miejscach trasy - znak w znak,
// z inną tylko nazwą stanu. Jedna kopia oznacza, że "jak wygląda filtr
// wybrany" jest JEDNĄ decyzją, a nie dwiema, które mogą się rozjechać.
export function GiftFilterChip({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`h-9 px-3 rounded-[6px] text-xs font-semibold border transition-colors ${
        active
          ? "bg-brand text-brand-foreground border-brand"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}
