// Organism: edytor widgetu "event-countdown-card". Reuzywa edytora odliczania
// (zrodlo daty, tytul, CTA, kolor akcentu) i dokłada pola specyficzne dla
// karty: okladka, liczba uczestnikow, badge oraz animacje.
import type { WidgetNode, Json } from "@/lib/builder/types";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PropField } from "../../atoms";
import { ImageSlot } from "./ImageSlot";
import { EventCountdownEditor } from "./EventCountdownEditor";
import { Image as ImageIcon } from "lucide-react";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const numOf = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

export function EventCountdownCardEditor({ c, lang, setContent }: Props) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const showAttendees = c.showAttendees !== false;
  const showCountdown = c.showCountdown !== false;
  const showLocation = c.showLocation !== false;
  const enableAnimations = c.enableAnimations !== false;
  const eventMode = strOf(c.mode) === "event";

  return (
    <div className="space-y-3">
      <EventCountdownEditor c={c} lang={lang} setContent={setContent} />

      <div className="space-y-2 rounded-[6px] border border-border/60 bg-muted/30 p-2">
        <h4 className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {l("Karta", "Card")}
        </h4>

        <ImageSlot
          label={l("Okładka", "Cover image")}
          icon={<ImageIcon className="h-3 w-3" />}
          value={strOf(c.image)}
          onChange={(v) => setContent("image", v)}
          hint={
            eventMode
              ? l(
                  "Puste = okładka wybranego wydarzenia.",
                  "Empty = cover image of the selected event.",
                )
              : undefined
          }
        />

        <PropField label={l("Pokaż uczestników", "Show attendees")} inline>
          <Switch checked={showAttendees} onCheckedChange={(v) => setContent("showAttendees", v)} />
        </PropField>

        {showAttendees ? (
          <PropField
            label={l("Liczba uczestników", "Attendees count")}
            hint={
              eventMode
                ? l(
                    "W trybie wydarzenia liczba pochodzi z RSVP; ta wartość jest zapasowa.",
                    "In event mode the number comes from RSVPs; this value is a fallback.",
                  )
                : undefined
            }
          >
            <Input
              type="number"
              min={0}
              value={numOf(c.attendees) || ""}
              onChange={(e) => setContent("attendees", Math.max(0, Number(e.target.value) || 0))}
              className="h-8 text-xs"
            />
          </PropField>
        ) : null}

        <PropField label={l("Pokaż odliczanie", "Show countdown")} inline>
          <Switch checked={showCountdown} onCheckedChange={(v) => setContent("showCountdown", v)} />
        </PropField>

        <PropField label={l("Pokaż lokalizację", "Show location")} inline>
          <Switch checked={showLocation} onCheckedChange={(v) => setContent("showLocation", v)} />
        </PropField>

        {showLocation ? (
          <PropField
            label={l("Lokalizacja", "Location") + ` (${lang.toUpperCase()})`}
            hint={
              eventMode
                ? l(
                    "Puste = lokalizacja wybranego wydarzenia.",
                    "Empty = location of the selected event.",
                  )
                : undefined
            }
          >
            <Input
              value={strOf(c[`location_${lang}`])}
              onChange={(e) => setContent(`location_${lang}`, e.target.value)}
              className="h-8 text-xs"
              placeholder={l("Bruksela, Belgia", "Brussels, Belgium")}
            />
          </PropField>
        ) : null}

        <PropField
          label={
            l("Tekst pod komunikatem końca", "Text under finished message") +
            ` (${lang.toUpperCase()})`
          }
        >
          <Input
            value={strOf(c[`doneHint_${lang}`])}
            onChange={(e) => setContent(`doneHint_${lang}`, e.target.value)}
            className="h-8 text-xs"
            placeholder={l("Dołącz teraz, aby wziąć udział", "Join now to participate")}
          />
        </PropField>

        <PropField
          label={l("Animacje", "Animations")}
          hint={l(
            "Respektują ustawienie systemowe „ogranicz ruch”.",
            "Respects the system 'reduce motion' setting.",
          )}
          inline
        >
          <Switch
            checked={enableAnimations}
            onCheckedChange={(v) => setContent("enableAnimations", v)}
          />
        </PropField>
      </div>
    </div>
  );
}
