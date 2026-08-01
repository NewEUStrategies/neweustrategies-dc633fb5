// Organism: edytor widgetu "event-sponsors". Struktura: poziomy sponsorskie
// (nazwa PL/EN + rozmiar logotypów) -> sponsorzy (nazwa, logo, link, opis
// PL/EN). Edycja pracuje na znormalizowanym modelu (parseSponsorTiers)
// i zapisuje całość przez toJson - odporność na śmieci w treści legacy.
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { parseSponsorTiers, type SponsorEntry, type SponsorTier } from "@/lib/events/sponsors";
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
import { ChevronDown, ChevronUp } from "@/lib/lucide-shim";
import { PropField, ItemFrame, ColorField } from "../../atoms";
import { ListShell } from "./ListShell";
import type { Item } from "./shared";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

const strOf = (v: unknown): string => (typeof v === "string" ? v : "");
const newLocalId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function moveAt<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (target < 0 || target >= list.length) return list;
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function SponsorRow({
  sponsor,
  index,
  lang,
  onPatch,
  onRemove,
}: {
  sponsor: SponsorEntry;
  index: number;
  lang: "pl" | "en";
  onPatch: (patch: Partial<SponsorEntry>) => void;
  onRemove: () => void;
}) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  return (
    <div className="space-y-1.5 rounded-[6px] border border-border/60 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {sponsor.name || l("Sponsor", "Sponsor") + ` #${index + 1}`}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="text-[10px] text-muted-foreground hover:text-destructive"
        >
          {l("Usuń", "Remove")}
        </button>
      </div>
      <PropField label={l("Nazwa", "Name")}>
        <Input
          value={sponsor.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="h-8 text-xs"
        />
      </PropField>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={l("Logo (URL)", "Logo (URL)")}>
          <Input
            value={sponsor.logo}
            onChange={(e) => onPatch({ logo: e.target.value })}
            placeholder="https://…"
            className="h-8 text-xs"
          />
        </PropField>
        <PropField label={l("Link", "Link")}>
          <Input
            value={sponsor.url}
            onChange={(e) => onPatch({ url: e.target.value })}
            placeholder="https://…"
            className="h-8 text-xs"
          />
        </PropField>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <PropField label={`${l("Opis", "Description")} PL`}>
          <Textarea
            rows={2}
            value={sponsor.description_pl}
            onChange={(e) => onPatch({ description_pl: e.target.value })}
            className="text-xs"
          />
        </PropField>
        <PropField label={`${l("Opis", "Description")} EN`}>
          <Textarea
            rows={2}
            value={sponsor.description_en}
            onChange={(e) => onPatch({ description_en: e.target.value })}
            className="text-xs"
          />
        </PropField>
      </div>
    </div>
  );
}

export function SponsorsEditor({ c, lang, setContent }: Props) {
  const l = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const tiers = parseSponsorTiers(c);
  const commit = (next: SponsorTier[]) => setContent("tiers", toJson(next));
  const patchTier = (i: number, patch: Partial<SponsorTier>) =>
    commit(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const addTier = () =>
    commit([
      ...tiers,
      {
        id: newLocalId("tier"),
        name_pl: `Poziom ${tiers.length + 1}`,
        name_en: `Tier ${tiers.length + 1}`,
        size: "md",
        sponsors: [],
      },
    ]);

  return (
    <div className="space-y-3">
      <PropField label={l("Nagłówek", "Heading") + ` (${lang.toUpperCase()})`}>
        <Input
          value={strOf(c[`heading_${lang}`])}
          onChange={(e) => setContent(`heading_${lang}`, e.target.value)}
          className="h-8 text-xs"
          placeholder={l("Sponsorzy i partnerzy", "Sponsors & partners")}
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

      <div className="grid grid-cols-2 gap-2">
        <PropField
          label={l("Wyszarzone logo", "Grayscale logos")}
          hint={l("Kolor wraca po najechaniu.", "Color returns on hover.")}
          inline
        >
          <Switch
            checked={c.grayscale !== false}
            onCheckedChange={(v) => setContent("grayscale", v)}
          />
        </PropField>
        <PropField label={l("Kolor akcentu", "Accent color")}>
          <ColorField
            value={strOf(c.accentColor)}
            onChange={(v) => setContent("accentColor", v ?? "")}
          />
        </PropField>
      </div>

      <ListShell
        title={l("Poziomy sponsorskie", "Sponsor tiers")}
        items={tiers as unknown as Item[]}
        onAdd={addTier}
      >
        <div className="space-y-2">
          {tiers.map((tier, i) => (
            <ItemFrame
              key={tier.id}
              title={
                (lang === "pl" ? tier.name_pl : tier.name_en) ||
                tier.name_pl ||
                `${l("Poziom", "Tier")} #${i + 1}`
              }
              onRemove={() => commit(tiers.filter((_, j) => j !== i))}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="inline-flex gap-0.5">
                  <button
                    type="button"
                    onClick={() => commit(moveAt(tiers, i, -1))}
                    disabled={i === 0}
                    aria-label={l("Przesuń wyżej", "Move up")}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => commit(moveAt(tiers, i, 1))}
                    disabled={i === tiers.length - 1}
                    aria-label={l("Przesuń niżej", "Move down")}
                    className="rounded p-0.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </span>
                <Select
                  value={tier.size}
                  onValueChange={(v) => patchTier(i, { size: v === "lg" || v === "sm" ? v : "md" })}
                >
                  <SelectTrigger className="h-7 w-[150px] text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lg">{l("Duże logo (główni)", "Large (main)")}</SelectItem>
                    <SelectItem value="md">{l("Średnie logo", "Medium")}</SelectItem>
                    <SelectItem value="sm">{l("Małe logo (medialni)", "Small (media)")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PropField label={`${l("Nazwa poziomu", "Tier name")} PL`}>
                  <Input
                    value={tier.name_pl}
                    onChange={(e) => patchTier(i, { name_pl: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
                <PropField label={`${l("Nazwa poziomu", "Tier name")} EN`}>
                  <Input
                    value={tier.name_en}
                    onChange={(e) => patchTier(i, { name_en: e.target.value })}
                    className="h-8 text-xs"
                  />
                </PropField>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {l("Sponsorzy", "Sponsors")} ({tier.sponsors.length})
                </span>
                <button
                  type="button"
                  onClick={() =>
                    patchTier(i, {
                      sponsors: [
                        ...tier.sponsors,
                        {
                          id: newLocalId("spo"),
                          name: "",
                          logo: "",
                          url: "",
                          description_pl: "",
                          description_en: "",
                        },
                      ],
                    })
                  }
                  className="text-[11px] text-brand hover:underline"
                >
                  + {l("Dodaj sponsora", "Add sponsor")}
                </button>
              </div>
              <div className="space-y-2">
                {tier.sponsors.map((sponsor, j) => (
                  <SponsorRow
                    key={sponsor.id}
                    sponsor={sponsor}
                    index={j}
                    lang={lang}
                    onPatch={(p) =>
                      patchTier(i, {
                        sponsors: tier.sponsors.map((s, k) => (k === j ? { ...s, ...p } : s)),
                      })
                    }
                    onRemove={() =>
                      patchTier(i, { sponsors: tier.sponsors.filter((_, k) => k !== j) })
                    }
                  />
                ))}
              </div>
            </ItemFrame>
          ))}
        </div>
      </ListShell>
    </div>
  );
}
