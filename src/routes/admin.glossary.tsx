// Panel słowniczka pojęć (A7): /admin/glossary - CRUD terminów PL/EN.
// Mutacje przez RLS (glossary staff manage); publiczna strona /glossary
// i tooltipy we wpisach czytają tę samą tabelę.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BookOpen, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { slugifyTaxonomy } from "@/lib/content/taxonomySlug";
import { glossaryTermsQueryOptions, type GlossaryTerm } from "@/lib/queries/glossary";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirmDialog } from "@/lib/appDialogs";

export const Route = createFileRoute("/admin/glossary")({
  component: GlossaryAdmin,
});

interface Draft {
  term_pl: string;
  term_en: string;
  definition_pl: string;
  definition_en: string;
}

const EMPTY_DRAFT: Draft = { term_pl: "", term_en: "", definition_pl: "", definition_en: "" };

function GlossaryAdmin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const { data: terms } = useQuery(glossaryTermsQueryOptions());

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["public", "glossary-terms"] });

  const addM = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("glossary_terms").insert({
        term_pl: draft.term_pl.trim(),
        term_en: draft.term_en.trim(),
        definition_pl: draft.definition_pl.trim(),
        definition_en: draft.definition_en.trim() || null,
        slug: slugifyTaxonomy(draft.term_pl.trim()),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft(EMPTY_DRAFT);
      invalidate();
      toast.success(t("admin.glossary.added", { defaultValue: "Dodano termin" }));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("glossary_terms").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const remove = async (term: GlossaryTerm) => {
    const ok = await confirmDialog({
      title: t("admin.glossary.deleteTitle", { defaultValue: "Usunąć termin?" }),
      description: term.term_pl,
      confirmLabel: t("admin.glossary.deleteConfirm", { defaultValue: "Usuń" }),
      destructive: true,
    });
    if (ok) deleteM.mutate(term.id);
  };

  return (
    <AdminShell>
      <div className="p-4 lg:p-6 max-w-4xl mx-auto space-y-6">
        <h1 className="font-display text-xl inline-flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-brand" aria-hidden="true" />
          {t("admin.glossary.title", { defaultValue: "Słowniczek pojęć" })}
        </h1>
        <p className="text-sm text-muted-foreground -mt-3">
          {t("admin.glossary.hint", {
            defaultValue:
              "Pierwsze wystąpienie terminu w treści wpisu dostaje tooltip z definicją; całość publikuje się na /glossary.",
          })}
        </p>

        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              value={draft.term_pl}
              onChange={(e) => setDraft((d) => ({ ...d, term_pl: e.target.value }))}
              placeholder={t("admin.glossary.termPl", { defaultValue: "Termin (PL)" })}
              maxLength={140}
            />
            <Input
              value={draft.term_en}
              onChange={(e) => setDraft((d) => ({ ...d, term_en: e.target.value }))}
              placeholder={t("admin.glossary.termEn", { defaultValue: "Termin (EN)" })}
              maxLength={140}
            />
          </div>
          <Textarea
            value={draft.definition_pl}
            onChange={(e) => setDraft((d) => ({ ...d, definition_pl: e.target.value }))}
            placeholder={t("admin.glossary.defPl", { defaultValue: "Definicja (PL)" })}
            rows={2}
            maxLength={600}
          />
          <Textarea
            value={draft.definition_en}
            onChange={(e) => setDraft((d) => ({ ...d, definition_en: e.target.value }))}
            placeholder={t("admin.glossary.defEn", {
              defaultValue: "Definicja (EN, opcjonalna)",
            })}
            rows={2}
            maxLength={600}
          />
          <Button
            size="sm"
            disabled={!draft.term_pl.trim() || !draft.definition_pl.trim() || addM.isPending}
            onClick={() => addM.mutate()}
          >
            <Plus className="w-4 h-4 mr-1" aria-hidden="true" />
            {t("admin.glossary.add", { defaultValue: "Dodaj termin" })}
          </Button>
        </div>

        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {(terms ?? []).map((term) => (
            <li key={term.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {term.term_pl}
                  {term.term_en && term.term_en !== term.term_pl && (
                    <span className="ml-2 text-xs text-muted-foreground">EN: {term.term_en}</span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground mt-0.5 break-words">
                  {term.definition_pl}
                </p>
                {term.definition_en && (
                  <p className="text-xs text-muted-foreground mt-0.5 break-words">
                    EN: {term.definition_en}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 shrink-0"
                aria-label={t("admin.glossary.deleteConfirm", { defaultValue: "Usuń" })}
                onClick={() => void remove(term)}
              >
                <Trash2 className="w-3.5 h-3.5 text-destructive" aria-hidden="true" />
              </Button>
            </li>
          ))}
          {(terms ?? []).length === 0 && (
            <li className="p-4 text-sm text-muted-foreground">
              {t("admin.glossary.empty", { defaultValue: "Brak terminów - dodaj pierwszy." })}
            </li>
          )}
        </ul>
      </div>
    </AdminShell>
  );
}
