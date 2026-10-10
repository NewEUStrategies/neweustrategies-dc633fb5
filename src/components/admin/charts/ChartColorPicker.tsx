// WYBÓR KOLORU SERII - próbki slotów palety, a nie lista nazw.
//
// Do PR2 kolor serii był niewidoczną listą natywną nad kwadracikiem 16 px:
// 27 nazw ASCII („sliwka", „czerwien"), bez próbek, bez tłumaczenia, a pod
// domyślną paletą ról wybór niczego nie zmieniał, bo rola nadpisywała slot.
//
// TERAZ (kontrakt PR2, „Colour picker behaviour"):
//   (a) próbka na przycisku to kolor NARYSOWANY (`seriesPaint` z rangą),
//       a nie zapisany slot;
//   (b) pod paletą ról pierwsze `FOCUS_SERIES_MAX` serii dostają zamiast
//       próbnika etykietę roli (`SeriesRoleChip`) - kolor zmienia wybór serii
//       wyróżnionej, nie slot;
//   (c) próbnik oferuje wyłącznie sloty z `PICKER_SLOTS` (3:1 na płycie
//       w obu motywach, odcień poza pasmem pomarańczu i żółci).
// Próbki rysują tokeny `var(--chart-N)`, więc przełączenie motywu przemalowuje
// je bez renderu, a geometria jest ta sama w obu motywach.
//
// KLAWIATURA. Próbki są ogłaszane jako przyciski opcji w grupie, więc działają
// jak grupa: jeden przystanek Tabu na grupę i strzałki po próbkach (`Grupa`).
// Do przeglądu końcowego PR2 strzałki nie robiły nic, a Tab szedł po
// wszystkich czternastu próbkach po kolei.
import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { slotAt } from "@/lib/charts/palette";
import { cn } from "@/lib/utils";
import {
  FOCUS_ROLE_KEYS,
  PICKER_OTHER,
  PICKER_RECOMMENDED,
  PICKER_SLOTS,
  slotLabel,
} from "./chartColorSlots";
import { useChartEditorT, type ChartEditorT, type EditorLang } from "./chartEditorI18n";

/** Kwadrat koloru - wyłącznie dekoracja; nazwę niesie kontrolka obok. */
export function ColorSwatch({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block h-4 w-4 shrink-0 rounded-[3px] border border-border", className)}
      style={{ background: color }}
    />
  );
}

/**
 * Etykieta roli palety `focus` - seria ma kolor z roli, a nie ze slotu, więc
 * zamiast próbnika stoi nazwa roli z wyjaśnieniem w podpowiedzi.
 */
export function SeriesRoleChip({ role, lang }: { role: number; lang?: EditorLang }) {
  const t = useChartEditorT(lang);
  const key = FOCUS_ROLE_KEYS[role];
  if (key === undefined) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-border px-1.5 py-px text-[10px] leading-4 text-muted-foreground"
      title={t("chartEditor.colors.roleTitle")}
    >
      {t(key)}
    </span>
  );
}

interface PickerProps {
  /** Slot zapisany w serii. */
  slot: number;
  /** Kolor NARYSOWANY - próbka na przycisku. */
  paint: string;
  /** Nazwa dostępna przycisku („Kolor serii Eksport"). */
  label: string;
  onChange: (slot: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang?: EditorLang;
  /** Przycisk w siatce ma `-1` (Tab chodzi po komórkach); w panelu - zwykły. */
  triggerTabIndex?: number;
}

/** Klawisz -> przesunięcie fokusu w grupie (`"start"`/`"end"` - skrajne próbki). */
const RUCH: Readonly<Record<string, -1 | 1 | "start" | "end">> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
  Home: "start",
  End: "end",
};

/**
 * Grupa próbek - wzorzec grupy radiowej ARIA: JEDEN przystanek Tabu na grupę
 * (próbka wybrana, a w grupie bez wyboru - pierwsza; potem ta, na której
 * stał fokus), strzałki, Home i End chodzą po próbkach z zawinięciem.
 * Strzałka przenosi fokus, ale NIE wybiera: wybór zamyka próbnik i zapisuje
 * krok historii, więc przeglądanie kolorów strzałkami zamykałoby okno przy
 * pierwszym naciśnięciu. Wybiera Enter, spacja albo klik.
 */
function Grupa({
  title,
  slots,
  current,
  onPick,
  t,
}: {
  title: string;
  slots: readonly number[];
  current: number;
  onPick: (slot: number) => void;
  t: ChartEditorT;
}) {
  const przyciski = useRef<(HTMLButtonElement | null)[]>([]);
  const [fokus, setFokus] = useState<number | null>(null);
  if (slots.length === 0) return null;
  const indeksWyboru = slots.indexOf(current);
  const przystanek = fokus ?? (indeksWyboru === -1 ? 0 : indeksWyboru);
  const przesun = (od: number, ruch: -1 | 1 | "start" | "end") => {
    const n = slots.length;
    const cel = ruch === "start" ? 0 : ruch === "end" ? n - 1 : (od + ruch + n) % n;
    przyciski.current[cel]?.focus();
  };
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      <div role="radiogroup" aria-label={title} className="grid grid-cols-7 gap-1">
        {slots.map((n, i) => {
          const nazwa = slotLabel(n, t);
          const wybrany = n === current;
          return (
            <button
              key={n}
              ref={(el) => {
                przyciski.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={wybrany}
              aria-label={nazwa}
              title={nazwa}
              tabIndex={i === przystanek ? 0 : -1}
              onFocus={() => setFokus(i)}
              onKeyDown={(e) => {
                const ruch = RUCH[e.key];
                if (ruch === undefined) return;
                e.preventDefault();
                przesun(i, ruch);
              }}
              data-slot={n}
              className={cn(
                "relative inline-flex h-7 w-7 items-center justify-center rounded border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                wybrany && "ring-2 ring-foreground/70",
              )}
              style={{ background: `var(--chart-${n})` }}
              onClick={() => onPick(n)}
            >
              {/* Znacznik wyboru na własnym krążku tła - czytelny na każdym
                  slocie w obu motywach, bez osobnego tokenu tuszu. */}
              {wybrany && (
                <span className="inline-flex rounded-full bg-background p-px">
                  <Check aria-hidden className="h-3 w-3 text-foreground" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChartColorPicker({
  slot,
  paint,
  label,
  onChange,
  open,
  onOpenChange,
  lang,
  triggerTabIndex,
}: PickerProps) {
  const t = useChartEditorT(lang);
  const poza = !PICKER_SLOTS.includes(slotAt(slot).slot);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          tabIndex={triggerTabIndex}
          aria-label={label}
          aria-haspopup="dialog"
          title={slotLabel(slot, t)}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-muted"
        >
          <ColorSwatch color={paint} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-2 p-2" aria-label={label}>
        <div className="text-xs font-medium">{t("chartEditor.colors.pickerTitle")}</div>
        {poza && <p className="text-[10px] text-muted-foreground">{slotLabel(slot, t)}</p>}
        <Grupa
          title={t("chartEditor.colors.recommended")}
          slots={PICKER_RECOMMENDED}
          current={slot}
          t={t}
          onPick={(n) => {
            onOpenChange(false);
            onChange(n);
          }}
        />
        <Grupa
          title={t("chartEditor.colors.other")}
          slots={PICKER_OTHER}
          current={slot}
          t={t}
          onPick={(n) => {
            onOpenChange(false);
            onChange(n);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
