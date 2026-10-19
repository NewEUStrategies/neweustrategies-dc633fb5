// Organism: edytor widgetu "meeting-booking" (networking 1-1). Tryb "host"
// (sloty wskazanej osoby - ProfilePicker) lub "event" (sloty networkingowe
// wydarzenia - EventPicker). Naglowek/wstep i18n, horyzont dni, przelaczniki
// panelu hosta i wizytowki hosta przy slocie.
import type { WidgetNode, Json } from "@/lib/builder/types";
import { meetingSlotsInput } from "@/lib/builder/meetingsQuery";
import { getBool } from "@/components/builder/organisms/widget-view/frame";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropField, ColorField } from "../../atoms";
import { ClampedNumberInput } from "../../atoms/ClampedNumberInput";
import { EventPicker } from "./EventPicker";
import { ProfilePicker } from "./ProfilePicker";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");

export function MeetingBookingEditor({ c, lang, setContent }: Props) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const mode = strOf(c.mode) === "event" ? "event" : "host";
  // Horyzont z TEGO SAMEGO normalizatora, z którego widok buduje zapytanie
  // o sloty (`meetingSlotsInput`) - panel pokazuje dokładnie tyle dni, o ile
  // strona zapyta bazę. Normalizator dostaje sam `daysAhead`, żeby panel nie
  // czytał kluczy trybu, którego w tej chwili nie pokazuje.
  const daysAhead = meetingSlotsInput({ daysAhead: c.daysAhead }).daysAhead;

  return (
    <div className="space-y-3">
      <PropField label={l("Nagłówek", "Heading") + ` (${lang.toUpperCase()})`}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={l("Umów spotkanie 1-1", "Book a 1-1 meeting")}
        />
      </PropField>
      <PropField label={l("Wstęp", "Intro") + ` (${lang.toUpperCase()})`}>
        <Textarea
          rows={2}
          value={strOf(c[`intro_${lang}`])}
          onChange={(e) => setContent(`intro_${lang}`, e.target.value)}
          className="text-xs"
        />
      </PropField>

      <PropField
        label={l("Źródło slotów", "Slots source")}
        hint={l(
          "Host = sloty jednej osoby (ekspert/prelegent). Wydarzenie = sloty networkingowe wszystkich hostów.",
          "Host = one person's slots (expert/speaker). Event = networking slots of every host.",
        )}
      >
        <Select value={mode} onValueChange={(v) => setContent("mode", v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="host">{l("Sloty hosta", "Host slots")}</SelectItem>
            <SelectItem value="event">{l("Networking wydarzenia", "Event networking")}</SelectItem>
          </SelectContent>
        </Select>
      </PropField>

      {mode === "host" ? (
        <PropField label={l("Host (profil platformy)", "Host (platform profile)")}>
          <ProfilePicker
            value={strOf(c.hostUserId)}
            lang={lang}
            onPick={(hit) => setContent("hostUserId", hit.id)}
            onClear={() => setContent("hostUserId", "")}
          />
        </PropField>
      ) : (
        <PropField label={l("Wydarzenie", "Event")}>
          <EventPicker
            value={strOf(c.eventId)}
            onChange={(id) => setContent("eventId", id)}
            lang={lang}
          />
        </PropField>
      )}

      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Horyzont (dni)", "Days ahead")}>
          <ClampedNumberInput
            value={daysAhead}
            min={1}
            max={90}
            ariaLabel={l("Horyzont (dni)", "Days ahead")}
            onCommit={(v) => {
              if (v !== undefined && v !== daysAhead) setContent("daysAhead", v);
            }}
          />
        </PropField>
        <PropField label={l("Kolor akcentu", "Accent color")}>
          <ColorField
            value={strOf(c.accentColor)}
            onChange={(v) => setContent("accentColor", v ?? "")}
          />
        </PropField>
      </div>

      <div className="rounded-[6px] border border-border/60 bg-muted/30 p-2 space-y-2">
        <PropField
          label={l("Panel hosta (dodawanie slotów)", "Host panel (publish slots)")}
          hint={l(
            "Zalogowany host widzi formularz publikowania własnych slotów.",
            "A signed-in host sees the publish-your-slot form.",
          )}
          inline
        >
          {/* Przełączniki czytane jak w `MeetingBookingView` (`getBool`). */}
          <Switch
            checked={getBool(c, "allowHostManage", true)}
            onCheckedChange={(v) => setContent("allowHostManage", v)}
          />
        </PropField>
        {mode === "event" && (
          <PropField label={l("Pokazuj hosta przy slocie", "Show host on the slot")} inline>
            <Switch
              checked={getBool(c, "showHost", true)}
              onCheckedChange={(v) => setContent("showHost", v)}
            />
          </PropField>
        )}
      </div>
    </div>
  );
}
