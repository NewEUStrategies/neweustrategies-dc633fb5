// Karta „Organizacja" w kroku 1 edytora wpisu: droplista istniejących organizacji
// z CRM + przycisk otwierający rozbudowany dialog (szukanie / dodanie nowej wraz
// z logo). Zapis idzie przez zwykłą maszynę formularza (history.set -> autosave),
// więc pole uczestniczy w undo/redo, w bramce niezapisanych zmian i w rewizjach
// jak każde inne - bez własnego przycisku „Zapisz".
//
// DLACZEGO PATCH WIELOKLUCZOWY, A NIE CZTERY WYWOŁANIA `set()`. Przypisanie
// organizacji zmienia JEDNOCZEŚNIE `organization_id` i trzy pola migawki. Cztery
// osobne `set()` dałyby cztery wpisy w historii undo (redaktor musiałby cofać
// cztery razy jedną czynność) i - co gorsza - cztery renderowania, z których
// każde mogłoby trafić w debounce autozapisu osobno, zapisując stan pośredni
// (nowe id ze starą nazwą). Patch jest atomowy, dokładnie jak w SeoPanel.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { InfoHint } from "../atoms";
import type { PostForm } from "../types";
import { OrganizationPickerDialog, type OrganizationSelection } from "./OrganizationPickerDialog";
import "@/lib/i18n-admin-post-panes";

const optionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  website: z.string().nullable(),
  logo_url: z.string().nullable(),
});

/** Ile organizacji mieści droplista, zanim redaktor musi użyć wyszukiwania. */
const DROPLIST_LIMIT = 50;

/** Wartość „brak organizacji" w <Select> - Radix nie przyjmuje pustego stringa. */
const NONE_VALUE = "__none__";

export function PostOrganizationPicker({
  form,
  onPatch,
}: {
  form: PostForm;
  /** Patch wieloklucza - jedno wejście w historii i jeden autozapis. */
  onPatch: (patch: Partial<PostForm>) => void;
}) {
  const { t } = useTranslation();
  const { tenantId } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);

  const options = useQuery({
    queryKey: ["post-organizations-droplist", tenantId],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_companies_public", {
        _query: "",
        _limit: DROPLIST_LIMIT,
      });
      if (error) throw error;
      const parsed = z.array(optionSchema).safeParse(data ?? []);
      if (!parsed.success) {
        console.error("search_companies_public parse error", parsed.error);
        return [];
      }
      return parsed.data;
    },
  });

  // Przypisana organizacja może NIE być w pierwszych 50 wynikach droplisty (albo
  // zniknąć z CRM). Dokładamy ją z migawki, żeby <Select> nie pokazał pustej
  // wartości dla wpisu, który ma organizację przypisaną - inaczej wyglądałoby to
  // jak utrata danych i zapraszało do „naprawienia" przez ponowny wybór.
  //
  // Zależność to `options.data`, nie `options.data ?? []`: fallback tworzy nową
  // tablicę przy każdym renderze i memo przestałoby cokolwiek zapamiętywać.
  const selectRows = useMemo(() => {
    const rows = options.data ?? [];
    const id = form.organization_id;
    if (!id) return rows;
    if (rows.some((r) => r.id === id)) return rows;
    return [
      {
        id,
        name: form.organization_name ?? id,
        website: form.organization_website,
        logo_url: form.organization_logo_url,
      },
      ...rows,
    ];
  }, [
    options.data,
    form.organization_id,
    form.organization_name,
    form.organization_website,
    form.organization_logo_url,
  ]);

  const apply = (selection: OrganizationSelection | null) => {
    onPatch(
      selection
        ? {
            organization_id: selection.id,
            organization_name: selection.name,
            organization_logo_url: selection.logoUrl,
            organization_website: selection.website,
          }
        : {
            organization_id: null,
            organization_name: null,
            organization_logo_url: null,
            organization_website: null,
          },
    );
  };

  // Odświeżenie migawki: przepisuje AKTUALNE dane firmy z CRM na wpis. Świadoma
  // czynność redakcji, nie automat - migawka ma być dowodem stanu z publikacji,
  // więc nikt nie przepisuje jej za plecami autora.
  //
  // Szukamy po NAZWIE z migawki, nie zaciągając całego katalogu: `search_companies_public`
  // filtruje `name ILIKE '%…%'`, więc nazwa własnej organizacji zwraca garść
  // wierszy zamiast pięciuset. Dopasowanie i tak idzie po `id` - nazwa jest tylko
  // zawężeniem zapytania i może być w CRM już zmieniona.
  const refreshSnapshot = async () => {
    const id = form.organization_id;
    if (!id) return;
    const { data, error } = await supabase.rpc("search_companies_public", {
      _query: form.organization_name?.trim() || "",
      _limit: 100,
    });
    const parsed = error ? null : z.array(optionSchema).safeParse(data ?? []);
    const fresh = parsed?.success ? parsed.data.find((r) => r.id === id) : undefined;
    if (!fresh) {
      // Brak trafienia znaczy tu jedno z dwóch: firmę usunięto z CRM albo
      // zmieniono jej nazwę tak, że nie pasuje do naszej migawki. W obu
      // przypadkach NIE czyścimy atrybucji - opublikowany wpis ma zachować to,
      // co czytelnik zobaczył. Mówimy tylko, że odświeżenie się nie udało.
      toast.error(t("adminPostPanes.organization.searchFailed"));
      return;
    }
    apply({
      id: fresh.id,
      name: fresh.name.trim(),
      logoUrl: fresh.logo_url?.trim() || null,
      website: fresh.website?.trim() || null,
    });
    toast.success(t("adminPostPanes.organization.refreshed"));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Building2 className="h-4 w-4 text-primary" aria-hidden="true" />
          {t("adminPostPanes.organization.title")}
        </h3>
        <InfoHint text={t("adminPostPanes.organization.snapshotHint")} />
      </div>
      <p className="text-[12px] text-muted-foreground">{t("adminPostPanes.organization.hint")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={form.organization_id ?? NONE_VALUE}
          onValueChange={(value) => {
            if (value === NONE_VALUE) {
              apply(null);
              return;
            }
            const row = selectRows.find((r) => r.id === value);
            if (!row) return;
            apply({
              id: row.id,
              name: row.name.trim(),
              logoUrl: row.logo_url?.trim() || null,
              website: row.website?.trim() || null,
            });
          }}
        >
          <SelectTrigger className="h-9 min-w-[16rem] flex-1 text-[13px]">
            <SelectValue placeholder={t("adminPostPanes.organization.none")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>{t("adminPostPanes.organization.none")}</SelectItem>
            {selectRows.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 text-[12px]"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {t("adminPostPanes.organization.pick")}
        </Button>
      </div>

      {form.organization_id && (
        <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background">
            {form.organization_logo_url ? (
              <img
                src={form.organization_logo_url}
                alt={t("adminPostPanes.organization.logoAlt")}
                className="h-full w-full object-contain"
              />
            ) : (
              <Building2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium">
              {form.organization_name ?? "—"}
            </span>
            {form.organization_website && (
              <span className="block truncate text-[11px] text-muted-foreground">
                {form.organization_website}
              </span>
            )}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-[12px]"
            onClick={() => void refreshSnapshot()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminPostPanes.organization.refreshSnapshot")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-[12px] text-muted-foreground hover:text-destructive"
            onClick={() => apply(null)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t("adminPostPanes.organization.detach")}
          </Button>
        </div>
      )}

      <OrganizationPickerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentId={form.organization_id}
        currentName={form.organization_name}
        onSelect={apply}
      />
    </div>
  );
}
