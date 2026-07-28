// Organism: edytor widgetu "event-countdown". Tryb "event" (data startu z
// modulu events, wybor przez EventPicker) lub "custom" (reczna data). Tytul,
// tekst po zakonczeniu i etykieta CTA sa i18n (PL/EN).
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropField, ColorField } from "../../atoms";
import { EventPicker } from "./EventPicker";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");

/** ISO -> wartosc pola datetime-local (lokalna, bez strefy). */
function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function EventCountdownEditor({ c, lang, setContent }: Props) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const mode = strOf(c.mode) === "event" ? "event" : "custom";
  const showSeconds = c.showSeconds !== false;
  const size = strOf(c.size) || "md";

  return (
    <div className="space-y-3">
      <PropField label={l("Źródło daty", "Date source")}>
        <Select value={mode} onValueChange={(v) => setContent("mode", v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom">{l("Ręczna data", "Custom date")}</SelectItem>
            <SelectItem value="event">{l("Wydarzenie", "Event")}</SelectItem>
          </SelectContent>
        </Select>
      </PropField>

      {mode === "event" ? (
        <PropField
          label={l("Wydarzenie", "Event")}
          hint={l("Odliczanie do daty startu wydarzenia.", "Counts down to the event start.")}
        >
          <EventPicker
            value={strOf(c.eventId)}
            onChange={(id) => setContent("eventId", id)}
            lang={lang}
          />
        </PropField>
      ) : (
        <PropField label={l("Data i godzina celu", "Target date & time")}>
          <Input
            type="datetime-local"
            value={isoToLocalInput(strOf(c.targetAt))}
            onChange={(e) => {
              const v = e.target.value;
              setContent("targetAt", v ? new Date(v).toISOString() : "");
            }}
            className="h-8 text-xs"
          />
        </PropField>
      )}

      <PropField label={l("Tytuł", "Title") + ` (${lang.toUpperCase()})`}>
        <Input
          value={strOf(c[`title_${lang}`])}
          onChange={(e) => setContent(`title_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={l("Do startu wydarzenia", "Event starts in")}
        />
      </PropField>
      <PropField label={l("Tekst po zakończeniu", "Finished text") + ` (${lang.toUpperCase()})`}>
        <Input
          value={strOf(c[`doneText_${lang}`])}
          onChange={(e) => setContent(`doneText_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={l("Wydarzenie trwa!", "The event is live!")}
        />
      </PropField>

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Rozmiar", "Size")}>
          <Select value={size} onValueChange={(v) => setContent("size", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="md">{l("Standardowy", "Default")}</SelectItem>
              <SelectItem value="lg">{l("Duży", "Large")}</SelectItem>
            </SelectContent>
          </Select>
        </PropField>
        <PropField label={l("Kolor akcentu", "Accent color")}>
          <ColorField
            value={strOf(c.accentColor)}
            onChange={(v) => setContent("accentColor", v ?? "")}
          />
        </PropField>
      </div>

      <PropField label={l("Pokazuj sekundy", "Show seconds")} inline>
        <Switch checked={showSeconds} onCheckedChange={(v) => setContent("showSeconds", v)} />
      </PropField>

      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <PropField
          label={l("Link CTA (opcjonalny)", "CTA link (optional)")}
          hint={l(
            "Puste w trybie wydarzenia = link do strony wydarzenia.",
            "Empty in event mode = link to the event page.",
          )}
        >
          <Input
            value={strOf(c.href)}
            onChange={(e) => setContent("href", e.target.value)}
            placeholder="/events/…"
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={l("Etykieta CTA", "CTA label") + ` (${lang.toUpperCase()})`}>
          <Input
            value={strOf(c[`ctaLabel_${lang}`])}
            onChange={(e) => setContent(`ctaLabel_${lang}`, e.target.value)}
            className="h-8 text-xs"
            placeholder={l("Zobacz wydarzenie", "View event")}
          />
        </PropField>
      </div>
    </div>
  );
}
