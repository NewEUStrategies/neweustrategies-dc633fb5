// Molekuła: PASEK NARZĘDZI listy wydarzeń - zakładki statusu i JEDEN rząd
// z szukaniem, filtrami i akcjami.
//
// PASEK MA JEDEN RZĄD, NIE DWA. Wcześniej akcje stały w nagłówku ekranu, a fraza
// z filtrami piętro niżej - redaktor szukał „gdzie się tworzy wydarzenie” w tym
// samym miejscu, w którym szukał „gdzie się filtruje”, i za każdym razem musiał
// zdecydować, które piętro go dotyczy. Wzorzec (zrzuty 04 i 08) trzyma to
// w jednym rzędzie: po LEWEJ szukanie, po PRAWEJ akcje, i ta granica jest stała
// na każdym ekranie.
//
// PRAWA TRÓJKA MA STAŁĄ KOLEJNOŚĆ: ustawienia rzeczy, eksport, akcja główna.
// Kolejność jest własnością paska, nie wołającego - dlatego gniazda są tu
// osobnymi propsami, a nie jednym `ReactNode`: slot na dowolny węzeł oddaje
// kolejność temu, kto go wypełnia, i rozjeżdża ją między ekranami.
//
// TYLKO AKCJA GŁÓWNA JEST WYPEŁNIONA I BEZ IKONY. Wypełnienie jest w tym
// układzie jedynym sygnałem „to jest ta jedna rzecz, po którą tu przyszedłeś”,
// a ikona przy napisie „Nowe wydarzenie” dodaje wagi przyciskowi, który już ją
// ma - i odbiera ją publikacji w pasku górnym, która jest OBRYSOWANA.
//
// AKCJA MODUŁU STOI PRZED TRÓJKĄ. Przypomnienia dotyczą wszystkich wydarzeń
// naraz, a nie tej listy - wstawione między eksport i akcję główną rozerwałyby
// trójkę, którą wzorzec trzyma razem.
//
// ZAKŁADKI NIOSĄ LICZBY. Zakładka bez liczby zmusza redaktora do kliknięcia,
// żeby dowiedzieć się, czy jest tam cokolwiek - a przy sześciu zakładkach to
// sześć kliknięć na każde wejście na listę. Liczby przychodzą z osobnego RPC,
// który IGNORUJE filtr statusu (inaczej „Szkice” pokazywałyby liczbę szkiców
// wśród szkiców).
//
// LICZBY RESPEKTUJĄ POZOSTAŁE FILTRY. Gdy lista jest zawężona do rodzaju
// „Webinar”, zakładki pokazują liczby webinarów. Odwrotne zachowanie
// (metryka licząca całość pod zawężoną listą) jest dokładnie tym antywzorcem,
// który zrzuty referencyjne przyznają wprost: „Group filtering is not
// considered for these metrics”.
//
// PRZYCISK „WYCZYŚĆ” POJAWIA SIĘ TYLKO GDY JEST CO CZYŚCIĆ. Przycisk bez skutku
// uczy redaktora, że przyciski nic nie robią.
//
// JEDNA ODPOWIEDZIALNOŚĆ: pokazać stan filtrów i oddać zmianę. Molekuła nie
// czyta serwera i nie zna słownika - napisy dostaje gotowe.
import { Download, Search, Settings, X } from "@/lib/lucide-shim";
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

/**
 * Gniazdo akcji paska: napis I zachowanie w jednym obiekcie.
 *
 * Dwa osobne propsy (`exportLabel`, `onExport`) dopuszczają dwa stany, których
 * nie chcemy mieć: napis bez akcji (przycisk-atrapa) i akcja bez napisu.
 * Gniazdo jest OPCJONALNE jako całość - ekran bez eksportu po prostu go nie
 * podaje i pasek zwiera się do dwóch przycisków, jak zrzut 31.
 */
export interface EventToolbarAction {
  label: string;
  onSelect: () => void;
  /** Akcja w toku - przycisk gaśnie, żeby nie wysłać drugiego żądania. */
  pending?: boolean;
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
  moduleAction,
  settingsAction,
  exportAction,
  primaryAction,
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
  /** Akcja całego modułu (przypomnienia) - tekstowa, przed trójką wzorca. */
  moduleAction?: EventToolbarAction;
  /** Ustawienia RZECZY, którą pokazuje lista (katalog rodzajów wydarzeń). */
  settingsAction?: EventToolbarAction;
  exportAction?: EventToolbarAction;
  /** Akcja główna ekranu - jedyny wypełniony przycisk w całym układzie. */
  primaryAction?: EventToolbarAction;
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

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
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
          {/* DROPLISTY ZOSTAJĄ NASZE. Wzorzec filtruje lejkiem wpiętym w nagłówek
              kolumny, ale to jego system - u nas rodzaj i format są droplistami
              z tego samego atomu, co reszta panelu, i stoją przy frazie, bo
              razem z nią zawężają listę. */}
          <FormSelect
            value={typeValue}
            options={typeOptions}
            aria-label={typeLabel}
            onValueChange={onTypeChange}
            className="w-full sm:w-44"
          />
          <FormSelect
            value={formatValue}
            options={formatOptions}
            aria-label={formatLabel}
            onValueChange={onFormatChange}
            className="w-full sm:w-44"
          />
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              <X className="h-4 w-4" aria-hidden="true" />
              {clearLabel}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {moduleAction === undefined ? null : (
            <Button
              variant="ghost"
              disabled={moduleAction.pending === true}
              onClick={moduleAction.onSelect}
            >
              {moduleAction.label}
            </Button>
          )}
          {settingsAction === undefined ? null : (
            <Button
              variant="ghost"
              disabled={settingsAction.pending === true}
              onClick={settingsAction.onSelect}
            >
              <Settings aria-hidden="true" />
              {settingsAction.label}
            </Button>
          )}
          {exportAction === undefined ? null : (
            <Button
              variant="ghost"
              disabled={exportAction.pending === true}
              onClick={exportAction.onSelect}
            >
              <Download aria-hidden="true" />
              {exportAction.label}
            </Button>
          )}
          {primaryAction === undefined ? null : (
            <Button disabled={primaryAction.pending === true} onClick={primaryAction.onSelect}>
              {primaryAction.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
