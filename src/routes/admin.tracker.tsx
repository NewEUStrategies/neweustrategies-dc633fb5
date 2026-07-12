// Panel trackera legislacyjnego: CRUD dossier + dodawanie aktualizacji do osi
// czasu. Aktualizacja z ustawionym etapem przestawia etap dossier (trigger DB)
// i wysyła alert obserwującym - stąd wyraźny komunikat po zapisie.
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Landmark, Plus, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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
import type { PolicyItem } from "@/lib/tracker/queries";

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
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
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
      toast.success(L("Zapisano dossier", "Dossier saved"));
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
            {L("Tracker legislacyjny UE", "EU legislative tracker")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {L(
              "Dossier, ich etapy i oś czasu aktualizacji. Aktualizacja z etapem powiadamia obserwujących.",
              "Dossiers, their stages and update timeline. A staged update notifies followers.",
            )}
          </p>
        </div>
        <Button onClick={startNew}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {L("Nowe dossier", "New dossier")}
        </Button>
      </header>

      {editingId && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {editingId === "new"
                ? L("Nowe dossier", "New dossier")
                : L("Edycja dossier", "Edit dossier")}
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
              <Field label={L("Referencja", "Reference")}>
                <Input
                  value={draft.reference}
                  onChange={(e) => set({ reference: e.target.value })}
                  placeholder="COM(2026) 123"
                />
              </Field>
              <Field label="Tytuł PL">
                <Input value={draft.title_pl} onChange={(e) => set({ title_pl: e.target.value })} />
              </Field>
              <Field label="Title EN">
                <Input value={draft.title_en} onChange={(e) => set({ title_en: e.target.value })} />
              </Field>
              <Field label="Opis PL">
                <Textarea
                  rows={2}
                  value={draft.summary_pl}
                  onChange={(e) => set({ summary_pl: e.target.value })}
                />
              </Field>
              <Field label="Summary EN">
                <Textarea
                  rows={2}
                  value={draft.summary_en}
                  onChange={(e) => set({ summary_en: e.target.value })}
                />
              </Field>
            </div>
            <div className="grid gap-3 md:grid-cols-4">
              <Field label={L("Obszar", "Area")}>
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
              <Field label={L("Etap", "Stage")}>
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
              <Field label={L("Waga", "Importance")}>
                <Select
                  value={String(draft.importance)}
                  onValueChange={(v) => set({ importance: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 — {L("niska", "low")}</SelectItem>
                    <SelectItem value="2">2 — {L("średnia", "medium")}</SelectItem>
                    <SelectItem value="3">3 — {L("kluczowa", "key")}</SelectItem>
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
              <Field label={L("Nast. kamień PL", "Next milestone PL")}>
                <Input
                  value={draft.next_milestone_pl}
                  onChange={(e) => set({ next_milestone_pl: e.target.value })}
                />
              </Field>
              <Field label={L("Nast. kamień EN", "Next milestone EN")}>
                <Input
                  value={draft.next_milestone_en}
                  onChange={(e) => set({ next_milestone_en: e.target.value })}
                />
              </Field>
              <Field label={L("Data kamienia", "Milestone date")}>
                <Input
                  type="date"
                  value={draft.next_milestone_at}
                  onChange={(e) => set({ next_milestone_at: e.target.value })}
                />
              </Field>
            </div>
            <Field label={L("Źródło (URL)", "Source (URL)")}>
              <Input
                value={draft.source_url}
                onChange={(e) => set({ source_url: e.target.value })}
              />
            </Field>
            <div className="flex gap-2">
              <Button disabled={saveItem.isPending} onClick={() => saveItem.mutate()}>
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
                {L("Zapisz", "Save")}
              </Button>
              <Button variant="ghost" onClick={() => setEditingId(null)}>
                {L("Anuluj", "Cancel")}
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
                  {lang === "pl" ? it.title_pl : it.title_en}
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
                {L("Edytuj", "Edit")}
              </Button>
              <AddUpdateButton itemId={it.id} label={L("Aktualizacja", "Update")} />
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

// Rozwijany formularz dodania wpisu do osi czasu dossier.
function AddUpdateButton({ itemId, label }: { itemId: string; label: string }) {
  const { i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "pl";
  const L = (pl: string, en: string) => (lang === "pl" ? pl : en);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [notePl, setNotePl] = useState("");
  const [noteEn, setNoteEn] = useState("");
  const [stageTo, setStageTo] = useState("none");
  const [sourceUrl, setSourceUrl] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("eu_policy_updates").insert({
        item_id: itemId,
        note_pl: notePl.trim(),
        note_en: noteEn.trim(),
        stage_to: stageTo === "none" ? null : stageTo,
        source_url: nullifyEmpty(sourceUrl),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        L(
          "Aktualizacja opublikowana — obserwujący dostali powiadomienie",
          "Update published — followers were notified",
        ),
      );
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
        <h3 className="text-base font-semibold">{L("Dodaj aktualizację", "Add update")}</h3>
        <Field label="Notatka PL">
          <Textarea rows={2} value={notePl} onChange={(e) => setNotePl(e.target.value)} />
        </Field>
        <Field label="Note EN">
          <Textarea rows={2} value={noteEn} onChange={(e) => setNoteEn(e.target.value)} />
        </Field>
        <Field label={L("Zmiana etapu (opcjonalnie)", "Stage change (optional)")}>
          <Select value={stageTo} onValueChange={setStageTo}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {L("— bez zmiany etapu —", "— no stage change —")}
              </SelectItem>
              {STAGE_LABELS.map((s) => (
                <SelectItem key={s.key} value={s.key}>
                  {lang === "pl" ? s.pl : s.en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={L("Źródło (URL)", "Source (URL)")}>
          <Input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button
            disabled={save.isPending || notePl.trim().length < 3 || noteEn.trim().length < 3}
            onClick={() => save.mutate()}
          >
            {L("Opublikuj", "Publish")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {L("Anuluj", "Cancel")}
          </Button>
        </div>
      </div>
    </div>
  );
}
