// Molekuła: PASEK FILTRÓW listy wydarzeń - zakładki statusu, fraza, rodzaj, format.
//
// ZAKŁADKI NIOSĄ LICZBY. Zakładka bez liczby zmusza redaktora do kliknięcia,
// żeby dowiedzieć się, czy jest tam cokolwiek - a przy sześciu zakładkach to
// sześć kliknięć na każde wejście na listę. Liczby przychodzą z osobnego RPC,
// który IGNORUJE filtr statusu (inaczej „Szkice" pokazywałyby liczbę szkiców
// wśród szkiców).
//
// LICZBY RESPEKTUJĄ POZOSTAŁE FILTRY. Gdy lista jest zawężona do rodzaju
// „Webinar", zakładki pokazują liczby webinarów. Odwrotne zachowanie
// (metryka licząca całość pod zawężoną listą) jest dokładnie tym antywzorcem,
// który zrzuty referencyjne przyznają wprost: „Group filtering is not
// considered for these metrics".
//
// PRZYCISK „WYCZYŚĆ" POJAWIA SIĘ TYLKO GDY JEST CO CZYŚCIĆ. Przycisk bez skutku
// uczy redaktora, że przyciski nic nie robią.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać stan filtrów i oddać zmianę. Molekuła nie
// czyta serwera i nie zna słownika - napisy dostaje gotowe.
import { Search, X } from "@/lib/lucide-shim";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FormSelect } from "@/components/atoms/FormSelect";
import { cn } from "@/lib/utils";

export interface EventFilterTab {
  key: string;
  label: string;
  count: number;
}

export interface EventFilterOption {
  value: string;
  label: string;
}

export function EventListFilters({
  tabs,
  activeTab,
  onTabChange,
  query,
  queryPlaceholder,
  onQueryChange,
  typeLabel,
  typeValue,
  typeOptions,
  onTypeChange,
  formatLabel,
  formatValue,
  formatOptions,
  onFormatChange,
  clearLabel,
  onClear,
  hasFilters,
}: {
  tabs: readonly EventFilterTab[];
  activeTab: string;
  onTabChange: (key: string) => void;
  query: string;
  queryPlaceholder: string;
  onQueryChange: (value: string) => void;
  typeLabel: string;
  typeValue: string;
  typeOptions: readonly EventFilterOption[];
  onTypeChange: (value: string) => void;
  formatLabel: string;
  formatValue: string;
  formatOptions: readonly EventFilterOption[];
  onFormatChange: (value: string) => void;
  clearLabel: string;
  onClear: () => void;
  hasFilters: boolean;
}) {
  return (
    <div className="space-y-3">
      <div
        className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]"
        role="tablist"
        aria-label={typeLabel}
      >
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.key)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
                active
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="tabular-nums text-[11px] text-muted-foreground">{tab.count}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_11rem_auto]">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            placeholder={queryPlaceholder}
            aria-label={queryPlaceholder}
            className="!pl-[38px]"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <FormSelect
          value={typeValue}
          options={typeOptions}
          aria-label={typeLabel}
          onValueChange={onTypeChange}
        />
        <FormSelect
          value={formatValue}
          options={formatOptions}
          aria-label={formatLabel}
          onValueChange={onFormatChange}
        />
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <X className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {clearLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
