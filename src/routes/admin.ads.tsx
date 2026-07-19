import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";
import { FloatingInput, FloatingTextarea } from "@/components/ui/floating-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import { toast } from "sonner";
import { Plus, Trash2 as Trash } from "@/lib/lucide-shim";
import {
  AD_PAGE_TYPE_LABELS,
  AD_POSITION_LABELS,
  AD_SLOT_KIND_LABELS,
  adTargetingToJson,
  parseAdTargeting,
  type AdLanguage,
  type AdPageType,
  type AdPlacement,
  type AdPosition,
  type AdSlot,
  type AdSlotKind,
  type AdTargeting,
} from "@/lib/ads/types";
import { useTranslation } from "react-i18next";
import { useInterestCatalog } from "@/hooks/useInterests";
import "@/lib/i18n-ads-admin";

import { confirmDialog } from "@/lib/appDialogs";
import { adminToast } from "@/lib/adminToasts";
export const Route = createFileRoute("/admin/ads")({ component: AdsAdmin });

function emptySlot(): Partial<AdSlot> {
  return {
    name: "",
    kind: "html",
    status: "active",
    requires_consent: true,
    html: "",
    script: "",
    image_url: "",
    image_link: "",
    image_alt: "",
    width: null,
    height: null,
    notes: "",
  };
}

function emptyPlacement(): Partial<AdPlacement> {
  return {
    slot_id: "",
    position: "top_of_post",
    page_type: "post",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
  };
}

function AdsAdmin() {
  return (
    <AdminShell hideSidebar>
      <div className="space-y-6">
        <header>
          <h1 className="font-display text-2xl font-bold">Reklamy</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sloty reklamowe (HTML/skrypt/grafika) i ich rozmieszczenie na stronach.
          </p>
        </header>
        <Tabs defaultValue="slots">
          <TabsList>
            <TabsTrigger value="slots">Sloty</TabsTrigger>
            <TabsTrigger value="placements">Rozmieszczenie</TabsTrigger>
            <TabsTrigger value="stats">Statystyki</TabsTrigger>
          </TabsList>
          <TabsContent value="slots" className="mt-4">
            <SlotsPanel />
          </TabsContent>
          <TabsContent value="placements" className="mt-4">
            <PlacementsPanel />
          </TabsContent>
          <TabsContent value="stats" className="mt-4">
            <StatsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </AdminShell>
  );
}

function TargetingHeader() {
  const { t } = useTranslation();
  return <>{t("adsAdmin.columnTargeting")}</>;
}

// Podsumowanie targetingu na liście slotów, np. "2 kat. - 1 tagi - PL".
function TargetingSummary({ slot }: { slot: AdSlot }) {
  const { t } = useTranslation();
  const parsed = parseAdTargeting(slot.targeting);
  const parts: string[] = [];
  if (parsed.categorySlugs?.length) {
    parts.push(`${parsed.categorySlugs.length} ${t("adsAdmin.summaryCategories")}`);
  }
  if (parsed.tagSlugs?.length) parts.push(`${parsed.tagSlugs.length} ${t("adsAdmin.summaryTags")}`);
  if (parsed.languages?.length) parts.push(parsed.languages.map((l) => l.toUpperCase()).join("/"));
  return (
    <span className="text-xs text-muted-foreground">
      {parts.length > 0 ? parts.join(" - ") : t("adsAdmin.summaryAll")}
    </span>
  );
}

function chipClass(active: boolean): string {
  return (
    "rounded-full border px-2.5 py-1 text-xs transition " +
    (active
      ? "border-primary bg-primary text-primary-foreground"
      : "border-border bg-background hover:bg-muted")
  );
}

// Edytor kolumny ad_slots.targeting: chipy kategorii/tagów (katalog
// zainteresowań) + przełączniki wersji językowych.
function TargetingEditor({
  value,
  onChange,
}: {
  value: AdTargeting;
  onChange: (next: AdTargeting) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang: AdLanguage = i18n.language === "en" ? "en" : "pl";
  const catalog = useInterestCatalog(lang);

  const toggleIn = (list: string[] | undefined, slug: string): string[] => {
    const set = new Set(list ?? []);
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    return Array.from(set);
  };

  return (
    <div className="sm:col-span-2 space-y-3 rounded-md border border-border p-3">
      <div>
        <Label className="mb-0">{t("adsAdmin.targetingTitle")}</Label>
        <p className="mt-1 text-xs text-muted-foreground">{t("adsAdmin.targetingHint")}</p>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.categories")}</p>
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {(catalog.data?.categories ?? []).map((c) => {
            const active = (value.categorySlugs ?? []).includes(c.slug);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  onChange({ ...value, categorySlugs: toggleIn(value.categorySlugs, c.slug) })
                }
                className={chipClass(active)}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.tags")}</p>
        <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
          {(catalog.data?.tags ?? []).map((tg) => {
            const active = (value.tagSlugs ?? []).includes(tg.slug);
            return (
              <button
                key={tg.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange({ ...value, tagSlugs: toggleIn(value.tagSlugs, tg.slug) })}
                className={chipClass(active)}
              >
                #{tg.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium">{t("adsAdmin.languages")}</p>
        <div className="flex gap-1.5">
          {(["pl", "en"] as const).map((l) => {
            const active = (value.languages ?? []).includes(l);
            return (
              <button
                key={l}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const set = new Set(value.languages ?? []);
                  if (set.has(l)) set.delete(l);
                  else set.add(l);
                  onChange({ ...value, languages: Array.from(set) });
                }}
                className={chipClass(active)}
              >
                {l.toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SlotsPanel() {
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [draft, setDraft] = useState<Partial<AdSlot>>(emptySlot());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase
      .from("ad_slots")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setSlots((data as AdSlot[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!draft.name?.trim()) {
      toast.error("Nazwa jest wymagana");
      return;
    }
    setBusy(true);
    const payload = { ...draft } as never;
    const { error } = draft.id
      ? await supabase.from("ad_slots").update(payload).eq("id", draft.id)
      : await supabase.from("ad_slots").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Zapisano slot");
      setDraft(emptySlot());
      load();
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({
        title: "Usunąć slot?",
        description: "Wszystkie powiązane pozycje również znikną.",
        destructive: true,
        confirmLabel: "Usuń",
      }))
    )
      return;
    const { error } = await supabase.from("ad_slots").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.deleted());
      load();
    }
  };

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-3">Nazwa</th>
              <th className="text-left p-3">Typ</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Zgoda</th>
              <th className="text-left p-3">
                <TargetingHeader />
              </th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => (
              <tr key={s.id} className="border-b border-border hover:bg-muted/40">
                <td className="p-3 font-medium">{s.name}</td>
                <td className="p-3">{AD_SLOT_KIND_LABELS[s.kind]}</td>
                <td className="p-3">{s.status === "active" ? "Aktywny" : "Wstrzymany"}</td>
                <td className="p-3">{s.requires_consent ? "Wymaga" : "Nie"}</td>
                <td className="p-3">
                  <TargetingSummary slot={s} />
                </td>
                <td className="p-3 text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(s)}>
                    Edytuj
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(s.id)}>
                    <Trash className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {slots.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-muted-foreground text-sm">
                  Brak slotów. Dodaj pierwszy poniżej.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-4">{draft.id ? "Edytuj slot" : "Nowy slot"}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <FloatingInput
            label="Nazwa"
            value={draft.name ?? ""}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div>
            <Label>Typ</Label>
            <Select
              value={draft.kind ?? "html"}
              onValueChange={(v) => setDraft({ ...draft, kind: v as AdSlotKind })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_SLOT_KIND_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {draft.kind === "html" && (
            <FloatingTextarea
              containerClassName="sm:col-span-2"
              label="Kod HTML"
              rows={4}
              value={draft.html ?? ""}
              onChange={(e) => setDraft({ ...draft, html: e.target.value })}
              className="font-mono text-xs"
            />
          )}
          {draft.kind === "script" && (
            <FloatingTextarea
              containerClassName="sm:col-span-2"
              label="Skrypt (np. AdSense)"
              rows={5}
              value={draft.script ?? ""}
              onChange={(e) => setDraft({ ...draft, script: e.target.value })}
              className="font-mono text-xs"
            />
          )}
          {draft.kind === "image" && (
            <>
              <FloatingInput
                containerClassName="sm:col-span-2"
                label="URL grafiki"
                value={draft.image_url ?? ""}
                onChange={(e) => setDraft({ ...draft, image_url: e.target.value })}
              />
              <FloatingInput
                label="Link kliknięcia"
                value={draft.image_link ?? ""}
                onChange={(e) => setDraft({ ...draft, image_link: e.target.value })}
              />
              <FloatingInput
                label="Alt (dla dostępności)"
                value={draft.image_alt ?? ""}
                onChange={(e) => setDraft({ ...draft, image_alt: e.target.value })}
              />
            </>
          )}

          <FloatingInput
            label="Szerokość (px)"
            type="number"
            value={draft.width ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, width: e.target.value ? Number(e.target.value) : null })
            }
          />
          <FloatingInput
            label="Wysokość (px)"
            type="number"
            value={draft.height ?? ""}
            onChange={(e) =>
              setDraft({ ...draft, height: e.target.value ? Number(e.target.value) : null })
            }
          />

          <div className="flex items-center gap-2">
            <Switch
              checked={draft.status === "active"}
              onCheckedChange={(v) => setDraft({ ...draft, status: v ? "active" : "paused" })}
            />
            <Label className="m-0">Aktywny</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={!!draft.requires_consent}
              onCheckedChange={(v) => setDraft({ ...draft, requires_consent: v })}
            />
            <Label className="m-0">Wymaga zgody marketingowej (RODO)</Label>
          </div>

          <TargetingEditor
            value={parseAdTargeting(draft.targeting)}
            onChange={(next) => setDraft({ ...draft, targeting: adTargetingToJson(next) })}
          />

          <FloatingTextarea
            containerClassName="sm:col-span-2"
            label="Notatki wewnętrzne"
            rows={2}
            value={draft.notes ?? ""}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
        <div className="flex gap-2 mt-5">
          <Button onClick={save} disabled={busy}>
            <Plus className="w-4 h-4 mr-2" />
            {draft.id ? "Zapisz" : "Dodaj slot"}
          </Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(emptySlot())}>
              Anuluj
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function PlacementsPanel() {
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [placements, setPlacements] = useState<AdPlacement[]>([]);
  const [draft, setDraft] = useState<Partial<AdPlacement>>(emptyPlacement());
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("ad_slots").select("*").order("name"),
      supabase.from("ad_placements").select("*").order("sort_order"),
    ]);
    setSlots((s as AdSlot[]) ?? []);
    setPlacements((p as AdPlacement[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const slotMap = useMemo(() => Object.fromEntries(slots.map((s) => [s.id, s])), [slots]);

  const save = async () => {
    if (!draft.slot_id) {
      toast.error("Wybierz slot");
      return;
    }
    setBusy(true);
    const payload = { ...draft } as never;
    const { error } = draft.id
      ? await supabase.from("ad_placements").update(payload).eq("id", draft.id)
      : await supabase.from("ad_placements").insert(payload);
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.saved());
      setDraft(emptyPlacement());
      load();
    }
  };

  const remove = async (id: string) => {
    if (
      !(await confirmDialog({ title: "Usunąć pozycję?", destructive: true, confirmLabel: "Usuń" }))
    )
      return;
    const { error } = await supabase.from("ad_placements").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(adminToast.deleted());
      load();
    }
  };

  const cfg = (draft.config ?? {}) as Record<string, unknown>;
  const setCfg = (key: string, val: unknown) =>
    setDraft({ ...draft, config: { ...cfg, [key]: val } });

  return (
    <div className="space-y-6">
      <section className="border border-border rounded-lg bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground border-b border-border">
            <tr>
              <th className="text-left p-3">Slot</th>
              <th className="text-left p-3">Pozycja</th>
              <th className="text-left p-3">Strony</th>
              <th className="text-left p-3">Aktywne</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {placements.map((p) => (
              <tr key={p.id} className="border-b border-border hover:bg-muted/40">
                <td className="p-3 font-medium">{slotMap[p.slot_id]?.name ?? "-"}</td>
                <td className="p-3">{AD_POSITION_LABELS[p.position]}</td>
                <td className="p-3">{AD_PAGE_TYPE_LABELS[p.page_type]}</td>
                <td className="p-3">{p.active ? "✓" : "-"}</td>
                <td className="p-3 text-right space-x-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft(p)}>
                    Edytuj
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                    <Trash className="w-4 h-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {placements.length === 0 && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground text-sm">
                  Brak pozycji.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="border border-border rounded-lg bg-card p-5">
        <h2 className="font-semibold mb-4">{draft.id ? "Edytuj pozycję" : "Nowa pozycja"}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label>Slot</Label>
            <Select
              value={draft.slot_id ?? ""}
              onValueChange={(v) => setDraft({ ...draft, slot_id: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Wybierz slot…" />
              </SelectTrigger>
              <SelectContent>
                {slots.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Pozycja na stronie</Label>
            <Select
              value={draft.position ?? "top_of_post"}
              onValueChange={(v) => setDraft({ ...draft, position: v as AdPosition })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_POSITION_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Typ strony</Label>
            <Select
              value={draft.page_type ?? "all"}
              onValueChange={(v) => setDraft({ ...draft, page_type: v as AdPageType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(AD_PAGE_TYPE_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FloatingInput
            label="Sortowanie"
            type="number"
            value={draft.sort_order ?? 0}
            onChange={(e) => setDraft({ ...draft, sort_order: Number(e.target.value) })}
          />

          {draft.position === "mid_post" && (
            <FloatingInput
              label="Po którym paragrafie"
              type="number"
              min={1}
              value={(cfg.paragraph as number) ?? 4}
              onChange={(e) => setCfg("paragraph", Number(e.target.value))}
            />
          )}
          {draft.position === "in_feed" && (
            <FloatingInput
              label="Co N kart"
              type="number"
              min={1}
              value={(cfg.every as number) ?? 5}
              onChange={(e) => setCfg("every", Number(e.target.value))}
            />
          )}
          {draft.position === "footer_slideup" && (
            <>
              <FloatingInput
                label="Opóźnienie pojawienia się (ms)"
                type="number"
                value={(cfg.delay_ms as number) ?? 3000}
                onChange={(e) => setCfg("delay_ms", Number(e.target.value))}
              />
              <div className="flex items-center gap-2 mt-6">
                <Switch
                  checked={(cfg.dismissible as boolean) ?? true}
                  onCheckedChange={(v) => setCfg("dismissible", v)}
                />
                <Label className="m-0">Można zamknąć</Label>
              </div>
            </>
          )}

          <div>
            <Label>Aktywne od</Label>
            <DateTimePicker
              value={draft.starts_at ?? null}
              onChange={(iso) => setDraft({ ...draft, starts_at: iso })}
              placeholder="Od razu (bez ograniczenia)"
            />
          </div>
          <div>
            <Label>Aktywne do</Label>
            <DateTimePicker
              value={draft.ends_at ?? null}
              onChange={(iso) => setDraft({ ...draft, ends_at: iso })}
              placeholder="Bezterminowo"
              minDate={draft.starts_at ? new Date(draft.starts_at) : undefined}
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              checked={!!draft.active}
              onCheckedChange={(v) => setDraft({ ...draft, active: v })}
            />
            <Label className="m-0">Aktywne</Label>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <Button onClick={save} disabled={busy}>
            <Plus className="w-4 h-4 mr-2" />
            {draft.id ? "Zapisz" : "Dodaj pozycję"}
          </Button>
          {draft.id && (
            <Button variant="outline" onClick={() => setDraft(emptyPlacement())}>
              Anuluj
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

// Impressions / clicks / CTR per slot. Reads ad_events via the staff-read RLS
// (tenant-scoped); table not in generated types yet -> cast. A handful of slots,
// so two head-count queries per slot is cheap.
function StatsPanel() {
  const { i18n } = useTranslation();
  const isPl = (i18n.language ?? "pl").startsWith("pl");
  const [rows, setRows] = useState<{ slot: AdSlot; impressions: number; clicks: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("ad_slots").select("*").order("name");
      const slots = (data as AdSlot[]) ?? [];
      const withCounts = await Promise.all(
        slots.map(async (s) => {
          const [{ count: imp }, { count: clk }] = await Promise.all([
            supabase
              .from("ad_events" as never)
              .select("*", { count: "exact", head: true })
              .eq("slot_id", s.id)
              .eq("kind", "impression"),
            supabase
              .from("ad_events" as never)
              .select("*", { count: "exact", head: true })
              .eq("slot_id", s.id)
              .eq("kind", "click"),
          ]);
          return { slot: s, impressions: imp ?? 0, clicks: clk ?? 0 };
        }),
      );
      if (!cancelled) {
        setRows(withCounts);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ctr = (imp: number, clk: number) => (imp > 0 ? `${((clk / imp) * 100).toFixed(1)}%` : "—");

  return (
    <section className="border border-border rounded-lg bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground border-b border-border">
          <tr>
            <th className="text-left p-3">Slot</th>
            <th className="text-right p-3">{isPl ? "Wyświetlenia" : "Impressions"}</th>
            <th className="text-right p-3">{isPl ? "Kliknięcia" : "Clicks"}</th>
            <th className="text-right p-3">CTR</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={4} className="p-6 text-center text-muted-foreground">
                {isPl ? "Wczytywanie…" : "Loading…"}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="p-6 text-center text-muted-foreground">
                {isPl ? "Brak danych." : "No data yet."}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.slot.id} className="border-b border-border">
                <td className="p-3 font-medium">{r.slot.name}</td>
                <td className="p-3 text-right tabular-nums">{r.impressions}</td>
                <td className="p-3 text-right tabular-nums">{r.clicks}</td>
                <td className="p-3 text-right tabular-nums">{ctr(r.impressions, r.clicks)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
