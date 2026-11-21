import type { Block } from "@/lib/blocks/types";
import { useBlocksI18n } from "@/lib/blocks/i18n";
import { useTranslation } from "react-i18next";
import { PlatformSelect } from "@/components/ui/platform-select";
import { readText } from "./dataVizShared";

interface Props {
  block: Block;
  onChange: (next: Block) => void;
}

const YEAR_SPAN = 5;

/**
 * Miesiąc i rok z wartości "YYYY-MM" (puste = bieżący miesiąc). Zwraca null
 * dla innych formatów, żeby nie zgadywać daty.
 */
export function splitMonthValue(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/** Kalendarz publikacji (Gutenberg "Calendar"). */
export function CalendarBlock({ block, onChange }: Props) {
  const i18n = useBlocksI18n();
  const { i18n: i18next } = useTranslation();
  const locale = i18next.language?.startsWith("en") ? "en-GB" : "pl-PL";
  const month = readText(block.data.month); // YYYY-MM, puste = bieżący
  const parts = splitMonthValue(month);
  const now = new Date();
  const year = parts?.year ?? now.getFullYear();
  const years = Array.from(
    { length: YEAR_SPAN * 2 + 1 },
    (_, i) => now.getFullYear() - YEAR_SPAN + i,
  );
  if (!years.includes(year)) years.push(year);
  years.sort((a, b) => a - b);
  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, i, 15)),
  );
  const write = (next: string) => onChange({ ...block, data: { ...block.data, month: next } });

  return (
    <div className="rounded-lg border border-dashed border-border p-3 space-y-2 bg-muted/20">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {i18n.editor("calendar", "title")}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <PlatformSelect
          aria-label={i18n.editor("calendar", "title")}
          value={parts ? String(parts.month) : ""}
          onChange={(e) => {
            const value = e.target.value;
            write(value ? `${year}-${value.padStart(2, "0")}` : "");
          }}
        >
          <option value="">{i18n.editor("calendar", "monthPh")}</option>
          {monthNames.map((name, i) => (
            <option key={name} value={String(i + 1)}>
              {name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)}
            </option>
          ))}
        </PlatformSelect>
        <PlatformSelect
          aria-label={i18n.editor("calendar", "year")}
          value={String(year)}
          onChange={(e) => {
            const m = parts?.month ?? now.getMonth() + 1;
            write(`${e.target.value}-${String(m).padStart(2, "0")}`);
          }}
        >
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </PlatformSelect>
      </div>
    </div>
  );
}
