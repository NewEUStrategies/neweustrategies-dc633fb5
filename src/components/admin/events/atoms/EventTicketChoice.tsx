// Atom: karta wyboru jednej z dwóch opcji (Bezpłatny/Płatny, Widoczny/Ukryty).
// Natywne radio pod spodem - klawiatura i czytnik ekranu działają bez kodu.
export function EventTicketChoice({
  name,
  selected,
  label,
  onSelect,
}: {
  name: string;
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <label
      className={[
        "flex cursor-pointer items-center gap-3 rounded-[6px] border p-3 text-sm font-medium transition-colors",
        selected
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border bg-card text-foreground hover:border-primary/60",
      ].join(" ")}
    >
      <input type="radio" name={name} className="sr-only" checked={selected} onChange={onSelect} />
      <span
        aria-hidden="true"
        className={[
          "h-4 w-4 shrink-0 rounded-full border",
          selected ? "border-primary bg-primary" : "border-muted-foreground/50",
        ].join(" ")}
      />
      {label}
    </label>
  );
}
