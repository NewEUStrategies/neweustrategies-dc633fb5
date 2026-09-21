// Panel trackera legislacyjnego: CRUD dossier + dodawanie aktualizacji do osi
// czasu. Aktualizacja z ustawionym etapem przestawia etap dossier (trigger DB)
// i wysyła alert obserwującym - stąd wyraźny komunikat po zapisie.
import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ensureI18n as ensureAdminTrackerI18n } from "@/lib/i18n-admin-tracker";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BookOpen, Landmark, Plus, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { runTrackerTickNow } from "@/lib/tracker-admin.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { POLICY_AREAS, STAGE_LABELS, stageLabel } from "@/lib/tracker/stages";
import { AdminDatePicker } from "@/components/admin/blocks/AdminDatePicker";
import { EU_COUNTRIES, STANCE_META } from "@/lib/tracker/euCountries";
import { POLICY_RELATIONS, fetchPositions, type PolicyItem } from "@/lib/tracker/queries";

export const Route = createFileRoute("/admin/tracker")({
  component: AdminTrackerPage,
});

const EMPTY_ITEM = {
  slug: "",
  title_pl: "",
  title_en: "",
  summary_pl: "",
  summary_en: "",
  policy_area: "general",
  stage: "proposal",
  importance: 2,
  reference: "",
  source_url: "",
  rapporteur: "",
  committee: "",
  lead_dg: "",
  next_milestone_pl: "",
  next_milestone_en: "",
  next_milestone_at: "",
  status: "draft",
};
type ItemDraft = typeof EMPTY_ITEM;

function itemToDraft(it: PolicyItem): ItemDraft {
  return {
    slug: it.slug,
    title_pl: it.title_pl,
    title_en: it.title_en,
    summary_pl: it.summary_pl ?? "",
    summary_en: it.summary_en ?? "",
    policy_area: it.policy_area,
    stage: it.stage,
    importance: it.importance,
    reference: it.reference ?? "",
    source_url: it.source_url ?? "",
    rapporteur: it.rapporteur ?? "",
    committee: it.committee ?? "",
    lead_dg: it.lead_dg ?? "",
    next_milestone_pl: it.next_milestone_pl ?? "",
    next_milestone_en: it.next_milestone_en ?? "",
    next_milestone_at: it.next_milestone_at ?? "",
    status: it.status,
  };
}

function nullifyEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function AdminTrackerPage() {
  // Rejestracja słownika w chunku KOMPONENTU trasy (nie w entry) - patrz
  // komentarz przy ensureI18n w lib/i18n-admin-tracker.ts.
  ensureAdminTrackerI18n();
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();

  const itemsQ = useQuery({
    queryKey: ["admin", "tracker-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eu_policy_items")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as PolicyItem[];
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const set = (patch: Partial<ItemDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const runTick = useServerFn(runTrackerTickNow);
  const runTickMut = useMutation({
    mutationFn: () => runTick(),
    onSuccess: (res) => {
      const pushSent = typeof res.push === "object" && "sent" in res.push ? res.push.sent : 0;
      toast.success(t("adminTracker.tickComplete", { count: pushSent }));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startNew = () => {
    setEditingId("new");
    setDraft(EMPTY_ITEM);
  };
  const startEdit = (it: PolicyItem) => {
    setEditingId(it.id);
    setDraft(itemToDraft(it));
  };

  const saveItem = useMutation({
    mutationFn: async () => {
      const payload = {
        slug: draft.slug.trim(),
        title_pl: draft.title_pl.trim(),
        title_en: draft.title_en.trim(),
        summary_pl: nullifyEmpty(draft.summary_pl),
        summary_en: nullifyEmpty(draft.summary_en),
        policy_area: draft.policy_area,
        stage: draft.stage,
        importance: draft.importance,
        reference: nullifyEmpty(draft.reference),
        source_url: nullifyEmpty(draft.source_url),
        rapporteur: nullifyEmpty(draft.rapporteur),
        committee: nullifyEmpty(draft.committee),
        lead_dg: nullifyEmpty(draft.lead_dg),
        next_milestone_pl: nullifyEmpty(draft.next_milestone_pl),
        next_milestone_en: nullifyEmpty(draft.next_milestone_en),
        next_milestone_at: nullifyEmpty(draft.next_milestone_at),
        status: draft.status,
      };
      if (editingId && editingId !== "new") {
        const { error } = await supabase
          .from("eu_policy_items")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("eu_policy_items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(t("adminTracker.dossierSaved"));
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["admin", "tracker-items"] });
      void qc.invalidateQueries({ queryKey: ["tracker"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Landmark className="h-6 w-6" aria-hidden="true" />
            {t("adminTracker.euLegislativeTracker")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("adminTracker.dossiersTheirStagesUpdateTimeline")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin/tracker-guide">
              <BookOpen className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {t("adminTracker.howWorks")}
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => runTickMut.mutate()}
            disabled={runTickMut.isPending}
          >
            <RefreshCw
              className={`mr-1.5 h-4 w-4 ${runTickMut.isPending ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            {t("adminTracker.runTickNow")}
          </Button>
          <Button onClick={startNew}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminTracker.newDossier")}
          </Button>
        </div>
      </header>

      {editingId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editingId === "new" ? t("adminTracker.newDossier") : t("adminTracker.editDossier")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Slug">
                <Input
                  value={draft.slug}
                  onChange={(e) => set({ slug: e.target.value })}
                  placeholder="ai-act"
                />
              </Field>
              <Field label={t("adminTracker.reference")}>
                <Input
                  value={draft.reference}
                  onChange={(e) => set({ reference: e.target.value })}
                  placeholder="COM(2026) 123"
                />
              </Field>
              <Field label={t("adminTracker.titlePl")}>
                <Input value={draft.title_pl} onChange={(e) => set({ title_pl: e.target.value })} />
              </Field>
              <Field label={t("adminTracker.titleEn")}>
                <Input value={draft.title_en} onChange={(e) => set({ title_en: e.target.value })} />
              </Field>
              <Field label={t("adminTracker.summaryPl")}>
                <Textarea
                  rows={2}
                  value={draft.summary_pl}
                  onChange={(e) => set({ summary_pl: e.target.value })}
                />
              </Field>
              <Field label={t("adminTracker.summaryEn")}>
                <Textarea
                  rows={2}
                  value={draft.summary_en}
                  onChange={(e) => set({ summary_en: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label={t("adminTracker.area")}>
                <Select value={draft.policy_area} onValueChange={(v) => set({ policy_area: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POLICY_AREAS.map((a) => (
                      <SelectItem key={a.key} value={a.key}>
                        {lang === "pl" ? a.pl : a.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("adminTracker.stage")}>
                <Select value={draft.stage} onValueChange={(v) => set({ stage: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAGE_LABELS.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {lang === "pl" ? s.pl : s.en}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("adminTracker.importance")}>
                <Select
                  value={String(draft.importance)}
                  onValueChange={(v) => set({ importance: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 - {t("adminTracker.low")}</SelectItem>
                    <SelectItem value="2">2 - {t("adminTracker.medium")}</SelectItem>
                    <SelectItem value="3">3 - {t("adminTracker.key")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Status">
                <Select value={draft.status} onValueChange={(v) => set({ status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">draft</SelectItem>
                    <SelectItem value="published">published</SelectItem>
                    <SelectItem value="archived">archived</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label={t("adminTracker.rapporteur")}>
                <Input
                  value={draft.rapporteur}
                  onChange={(e) => set({ rapporteur: e.target.value })}
                  placeholder="Jan Kowalski (EPP)"
                />
              </Field>
              <Field label={t("adminTracker.leadCommittee")}>
                <Input
                  value={draft.committee}
                  onChange={(e) => set({ committee: e.target.value })}
                  placeholder="LIBE"
                />
              </Field>
              <Field label={t("adminTracker.commissionDg")}>
                <Input
                  value={draft.lead_dg}
                  onChange={(e) => set({ lead_dg: e.target.value })}
                  placeholder="DG CNECT"
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label={t("adminTracker.nextMilestonePl")}>
                <Input
                  value={draft.next_milestone_pl}
                  onChange={(e) => set({ next_milestone_pl: e.target.value })}
                />
              </Field>
              <Field label={t("adminTracker.nextMilestoneEn")}>
                <Input
                  value={draft.next_milestone_en}
                  onChange={(e) => set({ next_milestone_en: e.target.value })}
                />
              </Field>
              <Field label={t("adminTracker.milestoneDate")}>
                <AdminDatePicker
                  value={draft.next_milestone_at || null}
                  onChange={(v) => set({ next_milestone_at: v ?? "" })}
                  lang={lang}
                  aria-label={t("adminTracker.milestoneDate")}
                />
              </Field>
            </div>
            <Field label={t("adminTracker.sourceUrl")}>
              <Input
                value={draft.source_url}
                onChange={(e) => set({ source_url: e.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button disabled={saveItem.isPending} onClick={() => saveItem.mutate()}>
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {t("adminTracker.save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditingId(null)}>
                {t("adminTracker.cancel")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {(itemsQ.data ?? []).map((it) => (
          <div
            key={it.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {pickLocalized(it, "title", lang)}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  {it.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {stageLabel(it.stage, lang)} · /{it.slug}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => startEdit(it)}>
                {t("adminTracker.edit")}
              </Button>
              <PositionsButton itemId={it.id} label={t("adminTracker.positions")} />
              <LinksButton
                itemId={it.id}
                allItems={itemsQ.data ?? []}
                label={t("adminTracker.links")}
              />
              <AddUpdateButton itemId={it.id} label={t("adminTracker.update")} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

// Edytor stanowisk 27 państw członkowskich dla dossier. Wiersz bez wybranego
// stanowiska nie jest zapisywany; wyczyszczenie istniejącego = DELETE.
// tenant_id/updated_by przypina trigger eu_policy_position_pin w bazie.
function PositionsButton({ itemId, label }: { itemId: string; label: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  type RowDraft = { stance: string; note_pl: string; note_en: string };
  const [rows, setRows] = useState<Record<string, RowDraft>>({});

  // Odczyt stanowisk idzie PRZEZ BIBLIOTEKĘ (`fetchPositions`): ta sama tabela,
  // ta sama lista kolumn (`POSITION_FIELDS`) i ten sam filtr po dossier, więc
  // duplikat zapytania w trasie nie miał czego dowodzić - a niósł własne
  // `as unknown as`. Zostaje TUTAJ: klucz cache w przestrzeni `["admin", ...]`
  // (panel czyta stanowiska dossier NIEOPUBLIKOWANYCH, więc jego wynik nie
  // może wpaść do wpisu współdzielonego ze stroną publiczną) oraz
  // `enabled: open` (draft budowany z bazy przy każdym otwarciu okna).
  const existingQ = useQuery({
    queryKey: ["admin", "tracker-positions", itemId],
    queryFn: () => fetchPositions(itemId),
    enabled: open,
  });

  // Draft budowany z bazy przy każdym otwarciu (dane mogły się zmienić).
  const openDialog = () => {
    setRows({});
    setOpen(true);
  };
  const existing = existingQ.data;
  const rowFor = (code: string): RowDraft => {
    if (rows[code]) return rows[code];
    const fromDb = existing?.find((p) => p.country_code === code);
    return {
      stance: fromDb?.stance ?? "none",
      note_pl: fromDb?.note_pl ?? "",
      note_en: fromDb?.note_en ?? "",
    };
  };
  const setRow = (code: string, patch: Partial<RowDraft>) =>
    setRows((r) => ({ ...r, [code]: { ...rowFor(code), ...patch } }));

  const save = useMutation({
    mutationFn: async () => {
      // tenant_id jest pinowany serwerowo przez trigger tg_eu_policy_position_pin;
      // wartość podana z klienta jest ignorowana. Typ wymaga stringa, więc
      // przekazujemy placeholder - trigger nadpisze go tenantem właściciela dossier.
      const upserts: {
        item_id: string;
        country_code: string;
        stance: string;
        note_pl: string | null;
        note_en: string | null;
        tenant_id: string;
      }[] = [];
      const deletes: string[] = [];
      const TENANT_PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
      for (const c of EU_COUNTRIES) {
        const row = rowFor(c.code);
        const had = existing?.some((p) => p.country_code === c.code) ?? false;
        if (row.stance === "none") {
          if (had) deletes.push(c.code);
          continue;
        }
        upserts.push({
          item_id: itemId,
          country_code: c.code,
          stance: row.stance,
          note_pl: nullifyEmpty(row.note_pl),
          note_en: nullifyEmpty(row.note_en),
          tenant_id: TENANT_PLACEHOLDER,
        });
      }
      if (upserts.length > 0) {
        const { error } = await supabase
          .from("eu_policy_positions")
          .upsert(upserts, { onConflict: "item_id,country_code" });
        if (error) throw error;
      }
      if (deletes.length > 0) {
        const { error } = await supabase
          .from("eu_policy_positions")
          .delete()
          .eq("item_id", itemId)
          .in("country_code", deletes);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(t("adminTracker.positionsSaved"));
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["admin", "tracker-positions", itemId] });
      void qc.invalidateQueries({ queryKey: ["tracker", "positions", itemId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={openDialog}>
        {label}
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-label={t("adminTracker.memberStatePositions")}
    >
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg bg-background shadow-lg">
        <div className="border-b border-border/60 px-5 py-4">
          <h3 className="text-base font-semibold">{t("adminTracker.memberStatePositions")}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("adminTracker.rowWithoutStancePublishedNote")}
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {existingQ.isLoading ? (
            <p className="text-sm text-muted-foreground">{t("adminTracker.loading")}</p>
          ) : (
            EU_COUNTRIES.map((c) => {
              const row = rowFor(c.code);
              return (
                <div
                  key={c.code}
                  className="grid items-center gap-2 md:grid-cols-[9rem_10rem_1fr_1fr]"
                >
                  <span className="text-sm font-medium">{lang === "en" ? c.en : c.pl}</span>
                  <Select value={row.stance} onValueChange={(v) => setRow(c.code, { stance: v })}>
                    <SelectTrigger aria-label={`${c.code} - ${t("adminTracker.stance")}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("adminTracker.none")}</SelectItem>
                      {STANCE_META.map((s) => (
                        <SelectItem key={s.key} value={s.key}>
                          {lang === "en" ? s.en : s.pl}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={row.note_pl}
                    maxLength={500}
                    placeholder={t("adminTracker.notePl")}
                    aria-label={`${c.code} - ${t("adminTracker.notePl")}`}
                    onChange={(e) => setRow(c.code, { note_pl: e.target.value })}
                  />
                  <Input
                    value={row.note_en}
                    maxLength={500}
                    placeholder={t("adminTracker.noteEn")}
                    aria-label={`${c.code} - ${t("adminTracker.noteEn")}`}
                    onChange={(e) => setRow(c.code, { note_en: e.target.value })}
                  />
                </div>
              );
            })
          )}
        </div>
        <div className="flex gap-2 border-t border-border/60 px-5 py-4">
          <Button disabled={save.isPending || existingQ.isLoading} onClick={() => save.mutate()}>
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminTracker.savePositions")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("adminTracker.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Edytor powiązanych aktów: dodaj/usuń skierowaną krawędź do innego dossier
// z typem relacji. Oba dossier muszą należeć do tego samego najemcy (guard DB).
function LinksButton({
  itemId,
  allItems,
  label,
}: {
  itemId: string;
  allItems: PolicyItem[];
  label: string;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [relation, setRelation] = useState<string>("related");

  const linksQ = useQuery({
    queryKey: ["admin", "tracker-links", itemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("eu_policy_links")
        .select("related_item_id, relation")
        .eq("item_id", itemId);
      if (error) throw error;
      return (data ?? []) as { related_item_id: string; relation: string }[];
    },
    enabled: open,
  });

  const titleOf = (id: string) => {
    const it = allItems.find((i) => i.id === id);
    if (!it) return id;
    return pickLocalized(it, "title", lang);
  };

  const addLink = useMutation({
    mutationFn: async () => {
      if (!targetId) return;
      const { error } = await supabase.from("eu_policy_links").upsert(
        // tenant_id nadpisuje trigger tg_eu_policy_link_pin (BEFORE INSERT/UPDATE)
        // - typ wygenerowany wymaga stringa, więc podajemy placeholder zerowy.
        {
          item_id: itemId,
          related_item_id: targetId,
          relation,
          tenant_id: "00000000-0000-0000-0000-000000000000",
        },
        { onConflict: "item_id,related_item_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      setTargetId("");
      void qc.invalidateQueries({ queryKey: ["admin", "tracker-links", itemId] });
      void qc.invalidateQueries({ queryKey: ["tracker", "links", itemId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeLink = useMutation({
    mutationFn: async (relatedId: string) => {
      const { error } = await supabase
        .from("eu_policy_links")
        .delete()
        .eq("item_id", itemId)
        .eq("related_item_id", relatedId);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "tracker-links", itemId] });
      void qc.invalidateQueries({ queryKey: ["tracker", "links", itemId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  const candidates = allItems.filter(
    (i) => i.id !== itemId && !(linksQ.data ?? []).some((l) => l.related_item_id === i.id),
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-label={t("adminTracker.relatedFiles")}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-background shadow-lg">
        <div className="border-b border-border/60 px-5 py-4">
          <h3 className="text-base font-semibold">{t("adminTracker.relatedFiles")}</h3>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {(linksQ.data ?? []).map((l) => (
            <div
              key={l.related_item_id}
              className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm"
            >
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{l.relation}</span>
              <span className="truncate">{titleOf(l.related_item_id)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto shrink-0 text-destructive"
                onClick={() => removeLink.mutate(l.related_item_id)}
              >
                {t("adminTracker.remove")}
              </Button>
            </div>
          ))}
          {(linksQ.data?.length ?? 0) === 0 && !linksQ.isLoading && (
            <p className="text-sm text-muted-foreground">{t("adminTracker.linksYet")}</p>
          )}
          <div className="grid gap-2 border-t border-border/60 pt-3 md:grid-cols-[1fr_10rem]">
            <Select value={targetId} onValueChange={setTargetId}>
              <SelectTrigger aria-label={t("adminTracker.dossier")}>
                <SelectValue placeholder={t("adminTracker.chooseDossier")} />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {pickLocalized(i, "title", lang)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={relation} onValueChange={setRelation}>
              <SelectTrigger aria-label={t("adminTracker.relation")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POLICY_RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 border-t border-border/60 px-5 py-4">
          <Button disabled={!targetId || addLink.isPending} onClick={() => addLink.mutate()}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {t("adminTracker.addLink")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("adminTracker.close")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// Rozwijany formularz dodania wpisu do osi czasu dossier.
function AddUpdateButton({ itemId, label }: { itemId: string; label: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notePl, setNotePl] = useState("");
  const [noteEn, setNoteEn] = useState("");
  const [stageTo, setStageTo] = useState("none");
  const [sourceUrl, setSourceUrl] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      // tenant_id jest ustawiany przez trigger tg_eu_policy_update_applied
      // z dossier - pusty UUID to placeholder, DB nadpisuje w BEFORE INSERT.
      const { error } = await supabase.from("eu_policy_updates").insert({
        tenant_id: "00000000-0000-0000-0000-000000000000",
        item_id: itemId,
        note_pl: notePl.trim(),
        note_en: noteEn.trim(),
        stage_to: stageTo === "none" ? null : stageTo,
        source_url: nullifyEmpty(sourceUrl),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("adminTracker.updatePublishedFollowersWereNotified"));
      setNotePl("");
      setNoteEn("");
      setStageTo("none");
      setSourceUrl("");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["tracker", "updates", itemId] });
      void qc.invalidateQueries({ queryKey: ["admin", "tracker-items"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
        {label}
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
    >
      <div className="w-full max-w-lg space-y-3 rounded-lg bg-background p-5 shadow-lg">
        <h3 className="text-base font-semibold">{t("adminTracker.addUpdate")}</h3>
        <Field label={t("adminTracker.updateNotePl")}>
          <Textarea rows={2} value={notePl} onChange={(e) => setNotePl(e.target.value)} />
        </Field>
        <Field label={t("adminTracker.updateNoteEn")}>
          <Textarea rows={2} value={noteEn} onChange={(e) => setNoteEn(e.target.value)} />
        </Field>
        <Field label={t("adminTracker.stageChangeOptional")}>
          <Select value={stageTo} onValueChange={setStageTo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("adminTracker.stageChange")}</SelectItem>
              {STAGE_LABELS.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {lang === "pl" ? s.pl : s.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("adminTracker.sourceUrl")}>
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button
            disabled={save.isPending || notePl.trim().length < 3 || noteEn.trim().length < 3}
            onClick={() => save.mutate()}
          >
            {t("adminTracker.publish")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("adminTracker.cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
