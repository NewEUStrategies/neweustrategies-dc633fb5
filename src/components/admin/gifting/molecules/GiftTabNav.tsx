// Molekuła: nawigacja zakładek panelu gifting.
//
// Zakładki są zrobione na PRZYCISKACH, nie na Radiksie, więc dostępność nie
// przychodzi z biblioteki - to `role="tablist"`, `role="tab"` i `aria-selected`
// są jedyną informacją dla czytnika ekranu, która zakładka jest otwarta.
// Podkreślenie samo tego nie mówi.
export function GiftTabNav<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="border-b border-border">
      <nav className="flex gap-1" role="tablist">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={active === x.id}
            onClick={() => onSelect(x.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-[6px] transition-colors ${
              active === x.id
                ? "border-b-2 border-brand text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {x.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
