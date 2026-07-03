// Editor for the "account-link" header widget.
// Lets editors design what shows up in the dropdown for guests, signed-in users,
// and staff. Supports: pages (from public.pages), profile presets, custom URLs,
// separators, and a dedicated logout entry. Bilingual labels + descriptions.
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toJson } from "@/lib/builder/types";
import type { WidgetNode, Json } from "@/lib/builder/types";
import { PropField, ItemFrame } from "../../atoms";
import { ListShell } from "./ListShell";
import { itemsOf, type Item } from "./shared";
import { ACCOUNT_PRESETS } from "../widget-view/AccountMenuWidget";
import { supabase } from "@/integrations/supabase/client";
import { ChevronUp, ChevronDown } from "lucide-react";

interface Props {
  c: WidgetNode["content"];
  lang: "pl" | "en";
  setContent: (k: string, v: Json) => void;
}

type Section = "guest" | "auth" | "staff";
type Kind = "preset" | "page" | "custom" | "separator" | "logout";

const SECTIONS: Array<{ value: Section; label: string }> = [
  { value: "guest", label: "Niezalogowani" },
  { value: "auth", label: "Zalogowani" },
  { value: "staff", label: "Zespół / Admin" },
];
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "preset", label: "Preset profilu" },
  { value: "page", label: "Strona z CMS" },
  { value: "custom", label: "Własny URL" },
  { value: "separator", label: "Separator" },
  { value: "logout", label: "Wyloguj" },
];

function newItem(section: Section): Item {
  return {
    id: `i_${Math.random().toString(36).slice(2, 8)}`,
    section,
    kind: "preset",
    presetKey: "profile",
    icon: "User",
    label_pl: "Nowa pozycja",
    label_en: "New item",
  };
}

function readStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function AccountLinkEditor({ c, lang, setContent }: Props) {
  const items = itemsOf(c, "items");
  const update = (next: Item[]) => setContent("items", toJson(next));
  const [pages, setPages] = useState<Array<{ slug: string; title: string }>>([]);
  const [section, setSection] = useState<Section>("guest");

  useEffect(() => {
    void supabase
      .from("pages")
      .select("slug, title_pl, title_en")
      .eq("status", "published")
      .order("title_pl")
      .then(({ data }) => {
        setPages(
          (data ?? []).map((p) => ({
            slug: String(p.slug),
            title:
              String(lang === "pl" ? p.title_pl : p.title_en) ||
              String(p.title_pl) ||
              String(p.slug),
          })),
        );
      });
  }, [lang]);

  const sectionItems = items.filter((it) => it.section === section);

  const move = (idx: number, dir: -1 | 1) => {
    // operate within visible section ordering
    const visible = items.map((it, i) => ({ it, i })).filter(({ it }) => it.section === section);
    const at = visible[idx];
    const swap = visible[idx + dir];
    if (!at || !swap) return;
    const next = items.slice();
    [next[at.i], next[swap.i]] = [next[swap.i], next[at.i]];
    update(next);
  };

  const replaceAt = (globalIdx: number, patch: Partial<Item>) => {
    update(items.map((x, j) => (j === globalIdx ? { ...x, ...patch } : x)));
  };

  return (
    <div className="space-y-4">
      {/* Style + presety nagłówków */}
      <div className="rounded-md border border-border/60 p-3 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Wygląd panelu
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label="Szerokość (px)">
            <Input
              type="number"
              className="h-8 text-xs"
              value={typeof c.panelWidth === "number" ? c.panelWidth : 280}
              onChange={(e) => setContent("panelWidth", Number(e.target.value) || 280)}
            />
          </PropField>
          <PropField label="Zaokrąglenie (px)">
            <Input
              type="number"
              className="h-8 text-xs"
              value={typeof c.panelRadius === "number" ? c.panelRadius : 12}
              onChange={(e) => setContent("panelRadius", Number(e.target.value) || 0)}
            />
          </PropField>
          <PropField label="Tło panelu">
            <Input
              type="color"
              className="h-8 w-full"
              value={readStr(c.panelBg) || "#ffffff"}
              onChange={(e) => setContent("panelBg", e.target.value)}
            />
          </PropField>
          <PropField label="Kolor tekstu">
            <Input
              type="color"
              className="h-8 w-full"
              value={readStr(c.panelText) || "#0f172a"}
              onChange={(e) => setContent("panelText", e.target.value)}
            />
          </PropField>
          <PropField label="Akcent (CTA)">
            <Input
              type="color"
              className="h-8 w-full"
              value={readStr(c.panelAccent) || "#FA9346"}
              onChange={(e) => setContent("panelAccent", e.target.value)}
            />
          </PropField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <PropField label={`Etykieta "Zaloguj" (${lang.toUpperCase()})`}>
            <Input
              className="h-8 text-xs"
              value={readStr(c[`signin_${lang}`])}
              onChange={(e) => setContent(`signin_${lang}`, e.target.value)}
            />
          </PropField>
          <PropField label={`Etykieta "Zarejestruj" (${lang.toUpperCase()})`}>
            <Input
              className="h-8 text-xs"
              value={readStr(c[`signup_${lang}`])}
              onChange={(e) => setContent(`signup_${lang}`, e.target.value)}
            />
          </PropField>
          <PropField label="URL ekranu logowania">
            <Input
              className="h-8 text-xs"
              value={readStr(c.signinHref) || "/login"}
              onChange={(e) => setContent("signinHref", e.target.value)}
            />
          </PropField>
          <PropField label="URL rejestracji">
            <Input
              className="h-8 text-xs"
              value={readStr(c.signupHref) || "/login?mode=signup"}
              onChange={(e) => setContent("signupHref", e.target.value)}
            />
          </PropField>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-xs">Sekcja:</Label>
        <Select value={section} onValueChange={(v) => setSection(v as Section)}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ListShell
        title={`Pozycje menu - ${SECTIONS.find((s) => s.value === section)?.label}`}
        items={sectionItems}
        onAdd={() => update([...items, newItem(section)])}
      >
        <div className="space-y-2">
          {sectionItems.map((it, visIdx) => {
            const globalIdx = items.indexOf(it);
            const kind = (typeof it.kind === "string" ? it.kind : "preset") as Kind;
            return (
              <ItemFrame
                key={globalIdx}
                title={`#${visIdx + 1} · ${KINDS.find((k) => k.value === kind)?.label ?? kind}`}
                onRemove={() => update(items.filter((_, j) => j !== globalIdx))}
              >
                <div className="flex items-center gap-1 mb-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    disabled={visIdx === 0}
                    onClick={() => move(visIdx, -1)}
                  >
                    <ChevronUp className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                    disabled={visIdx === sectionItems.length - 1}
                    onClick={() => move(visIdx, 1)}
                  >
                    <ChevronDown className="w-3 h-3" />
                  </Button>
                </div>

                <PropField label="Typ pozycji">
                  <Select value={kind} onValueChange={(v) => replaceAt(globalIdx, { kind: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </PropField>

                {kind === "preset" && (
                  <PropField label="Preset">
                    <Select
                      value={readStr(it.presetKey) || "profile"}
                      onValueChange={(v) => {
                        const p = ACCOUNT_PRESETS.find((x) => x.key === v);
                        replaceAt(globalIdx, {
                          presetKey: v,
                          icon: p?.icon ?? it.icon,
                          label_pl: it.label_pl || p?.label_pl,
                          label_en: it.label_en || p?.label_en,
                        });
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCOUNT_PRESETS.map((p) => (
                          <SelectItem key={p.key} value={p.key}>
                            {lang === "pl" ? p.label_pl : p.label_en}{" "}
                            <span className="text-muted-foreground">({p.href})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </PropField>
                )}

                {kind === "page" && (
                  <PropField label="Strona">
                    <Select
                      value={readStr(it.pageSlug)}
                      onValueChange={(v) => replaceAt(globalIdx, { pageSlug: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Wybierz stronę…" />
                      </SelectTrigger>
                      <SelectContent>
                        {pages.length === 0 && (
                          <div className="px-3 py-2 text-xs text-muted-foreground">
                            Brak opublikowanych stron.
                          </div>
                        )}
                        {pages.map((p) => (
                          <SelectItem key={p.slug} value={p.slug}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </PropField>
                )}

                {kind === "custom" && (
                  <>
                    <PropField label="URL (lub /ścieżka)">
                      <Input
                        className="h-8 text-xs"
                        value={readStr(it.customHref)}
                        onChange={(e) => replaceAt(globalIdx, { customHref: e.target.value })}
                      />
                    </PropField>
                    <PropField label="Otwórz w nowej karcie">
                      <input
                        type="checkbox"
                        checked={!!it.external}
                        onChange={(e) => replaceAt(globalIdx, { external: e.target.checked })}
                      />
                    </PropField>
                  </>
                )}

                {kind !== "separator" && (
                  <>
                    <PropField label="Ikona (Lucide)">
                      <Input
                        className="h-8 text-xs"
                        placeholder="np. User, Bookmark, LogOut"
                        value={readStr(it.icon)}
                        onChange={(e) => replaceAt(globalIdx, { icon: e.target.value })}
                      />
                    </PropField>
                    <PropField label={`Etykieta (${lang.toUpperCase()})`}>
                      <Input
                        className="h-8 text-xs"
                        value={readStr(it[`label_${lang}`])}
                        onChange={(e) =>
                          replaceAt(globalIdx, { [`label_${lang}`]: e.target.value })
                        }
                      />
                    </PropField>
                    <PropField label={`Opis (${lang.toUpperCase()})`}>
                      <Textarea
                        rows={2}
                        className="text-xs"
                        value={readStr(it[`desc_${lang}`])}
                        onChange={(e) => replaceAt(globalIdx, { [`desc_${lang}`]: e.target.value })}
                      />
                    </PropField>
                  </>
                )}
              </ItemFrame>
            );
          })}
        </div>
      </ListShell>
    </div>
  );
}
