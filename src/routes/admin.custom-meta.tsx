// Admin route: manage global "Custom Meta" definitions per tenant.
// Each definition becomes a per-post field on the post editor.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ensureI18n as ensureAdminMiscRoutesI18n } from "@/lib/i18n-admin-misc-routes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FloatingInput } from "@/components/ui/floating-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequiredTenant } from "@/hooks/useAuth";
import {
  listCustomMetaDefs,
  addCustomMetaDef,
  updateCustomMetaDef,
  deleteCustomMetaDef,
  type CustomMetaDef,
} from "@/lib/customMeta";
import { CUSTOM_META_ICON_NAMES } from "@/components/post/CustomMetaList";

import { confirmDialog } from "@/lib/appDialogs";
import { adminToast } from "@/lib/adminToasts";
import { adminPageHead } from "@/lib/adminPageHead";
export const Route = createFileRoute("/admin/custom-meta")({
  component: CustomMetaAdmin,
  head: () =>
    adminPageHead(
      "Custom meta fields",
      "Define global custom meta fields available on every post. New European Strategies administration.",
    ),
  errorComponent: ({ error }) => (
    <div role="alert" className="p-6">
      {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-6">404</div>,
});

// `position: null` = pozycja automatyczna, liczona przy KAŻDYM renderze z
// aktualnej listy (koniec listy). Wcześniej domyślna pozycja była zamrażana
// w inicjalizatorze `useState` (lista jeszcze się ładowała, więc zawsze 10)
// i po zapisie z długości listy sprzed odświeżenia - nowe pole lądowało na
// pozycji już zajętej. `id` obecne = edycja istniejącej definicji - w tym samym
// obiekcie co pola, bo reset po zapisie porównuje formularz z wysłaną migawką.
type Draft = Omit<CustomMetaDef, "id" | "tenant_id" | "position"> & {
  id?: string;
  position: number | null;
};

const EMPTY_DRAFT: Draft = {
  key: "",
  label_pl: "",
  label_en: "",
  icon: "Clock",
  position: null,
};

// Limit klucza w `posts.custom_meta` (schemat zapisu wpisu w
// `content.functions.ts`: `z.record(z.string().max(64), ...)`). Dłuższy klucz
// dawał pole w edytorze wpisu, którego wartości serwer nigdy nie przyjmie.
const KEY_MAX_LENGTH = 64;

/** Klucz w postaci zapisywanej w bazie: a-z, 0-9, `_`. */
function normalizeMetaKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_");
}

function CustomMetaAdmin() {
  // Rejestracja słowników w chunku trasy (nie w entry) - patrz lib/i18n-*.
  ensureAdminMiscRoutesI18n();
  const { t } = useTranslation();
  const tenantId = useRequiredTenant();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["customMetaDefs", tenantId] as const,
    queryFn: () => listCustomMetaDefs(tenantId),
  });
  const defs = data ?? [];
  // Koniec listy, nie jej długość: po usunięciu środkowej definicji
  // `(length + 1) * 10` trafiało w pozycję ostatniej.
  const nextPosition = defs.reduce((max, d) => Math.max(max, d.position), 0) + 10;

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const editingId = draft.id ?? null;
  // Wysłana migawka w trakcie zapisu (`null` = brak zapisu). Podwójne kliknięcie
  // dawało dwa zapisy i dwa toasty, a drugi INSERT tego samego klucza kończy się
  // już komunikatem o zajętym kluczu.
  const [saving, setSaving] = useState<Draft | null>(null);
  const iconFieldId = useId();

  const refresh = () => qc.invalidateQueries({ queryKey: ["customMetaDefs"] });

  const save = async (): Promise<void> => {
    // Migawka z chwili kliknięcia: pola i „Edytuj” przy pozostałych wierszach
    // zostają czynne w trakcie zapisu, więc po nim formularz czyścimy tylko, jeśli
    // redaktor nie zaczął w nim czegoś innego (każda zmiana i „Edytuj” dają nowy obiekt).
    const submitted = draft;
    // W edycji klucz jest niezmienny (pole wyłączone, UPDATE go nie wysyła), bo
    // wartości we wpisach siedzą pod tym kluczem. Format i limit dotyczą tylko
    // NOWYCH kluczy - starsza definicja z kluczem „_” albo dłuższym niż 64 znaki
    // nadal musi dać się edytować (etykiety, ikona, pozycja).
    const key = normalizeMetaKey(submitted.key);
    if (!submitted.id) {
      if (!submitted.key.trim()) {
        toast.error(adminToast.keyRequired());
        return;
      }
      // Walidujemy klucz PO normalizacji: „ąę” czy „!!!” dawały klucz „_”,
      // który przechodził sprawdzenie niepustości.
      if (!/[a-z0-9]/.test(key) || key.length > KEY_MAX_LENGTH) {
        toast.error(t("adminMiscRoutes.customMeta.keyInvalid", { max: KEY_MAX_LENGTH }));
        return;
      }
    }
    if (!submitted.label_pl.trim() && !submitted.label_en.trim()) {
      toast.error(adminToast.labelRequired());
      return;
    }
    // Natychmiastowa podpowiedź z listy na ekranie. Rozstrzyga jednak baza
    // (INSERT na `UNIQUE (tenant_id, key)`) - lista w cache bywa sprzed minut.
    if (!submitted.id && defs.some((d) => d.key === key)) {
      toast.error(t("adminMiscRoutes.customMeta.keyTaken"));
      return;
    }
    setSaving(submitted);
    try {
      const fields = {
        label_pl: submitted.label_pl,
        label_en: submitted.label_en,
        icon: submitted.icon,
        position: submitted.position ?? nextPosition,
      };
      const result = submitted.id
        ? await updateCustomMetaDef(submitted.id, fields)
        : await addCustomMetaDef({ ...fields, tenant_id: tenantId, key });
      if (!result.ok) {
        if (result.reason === "key_taken") {
          // Wpis zostaje w formularzu - redaktor poprawia klucz, nie przepisuje danych.
          toast.error(t("adminMiscRoutes.customMeta.keyTaken"));
        } else if (result.reason === "forbidden") {
          // Wiersz stoi, tylko RLS nie pozwala go zmienić (np. autorowi) - to nie
          // „usunięta”, a formularz zostaje przy wierszu, który dalej istnieje.
          toast.error(t("adminMiscRoutes.customMeta.noPermission"));
        } else {
          toast.error(t("adminMiscRoutes.customMeta.deletedMeanwhile"));
          // Formularz nie może dalej wskazywać nieistniejącego wiersza; edycja
          // innego wiersza zaczęta w trakcie zapisu zostaje.
          setDraft((d) => (d.id === submitted.id ? EMPTY_DRAFT : d));
        }
        // Lista pokazuje stan, o który zapis się rozbił: cudzą definicję albo jej brak.
        refresh();
        return;
      }
      toast.success(adminToast.saved());
      setDraft((d) => (d === submitted ? EMPTY_DRAFT : d));
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("adminMiscRoutes.customMeta.saveError"));
    } finally {
      setSaving(null);
    }
  };

  const edit = (d: CustomMetaDef): void => {
    setDraft({
      id: d.id,
      key: d.key,
      label_pl: d.label_pl,
      label_en: d.label_en,
      icon: d.icon,
      position: d.position,
    });
  };

  const remove = async (id: string): Promise<void> => {
    if (
      !(await confirmDialog({
        title: t("adminMiscRoutes.customMeta.confirmTitle"),
        destructive: true,
        confirmLabel: t("adminMiscRoutes.customMeta.confirmLabel"),
      }))
    )
      return;
    try {
      await deleteCustomMetaDef(id);
      // Formularz nie zostaje przy usuniętej definicji - „Zapisz zmiany”
      // meldowałby usunięcie „w międzyczasie”, choć usunął ją sam redaktor.
      // Stan bieżący, nie z chwili kliknięcia „Usuń”: „Edytuj” tego wiersza
      // kliknięte w trakcie usuwania też ma zostać zamknięte.
      setDraft((d) => (d.id === id ? EMPTY_DRAFT : d));
      refresh();
      toast.success(adminToast.deleted());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("adminMiscRoutes.customMeta.genericError"));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl">{t("adminMiscRoutes.customMeta.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("adminMiscRoutes.customMeta.intro")}</p>
        </div>
        <Link to="/admin" className="text-sm text-brand underline">
          ← Admin
        </Link>
      </header>

      <section className="rounded-lg border border-border bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">
          {editingId
            ? t("adminMiscRoutes.customMeta.sectionEdit")
            : t("adminMiscRoutes.customMeta.sectionAdd")}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <FloatingInput
              label={t("adminMiscRoutes.customMeta.keyLabel")}
              value={draft.key}
              onChange={(e) => setDraft({ ...draft, key: e.target.value })}
              maxLength={KEY_MAX_LENGTH}
              disabled={!!editingId}
            />
          </div>
          <div>
            {/* Bez powiązania etykiety lista ikon nie ma nazwy dla czytnika ekranu. */}
            <Label htmlFor={iconFieldId}>{t("adminMiscRoutes.customMeta.icon")}</Label>
            <Select value={draft.icon} onValueChange={(v) => setDraft({ ...draft, icon: v })}>
              <SelectTrigger id={iconFieldId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CUSTOM_META_ICON_NAMES.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <FloatingInput
            label={t("adminMiscRoutes.customMeta.labelPl")}
            value={draft.label_pl}
            onChange={(e) => setDraft({ ...draft, label_pl: e.target.value })}
          />
          <FloatingInput
            label={t("adminMiscRoutes.customMeta.labelEn")}
            value={draft.label_en}
            onChange={(e) => setDraft({ ...draft, label_en: e.target.value })}
          />
          <FloatingInput
            label={t("adminMiscRoutes.customMeta.position")}
            type="number"
            value={draft.position ?? nextPosition}
            onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="flex gap-2 justify-end">
          {editingId && (
            <Button variant="outline" onClick={() => setDraft(EMPTY_DRAFT)}>
              {t("common.cancel")}
            </Button>
          )}
          {/* Bez wczytanej listy nie da się sprawdzić zajętości klucza ani
              policzyć końca listy. */}
          <Button onClick={save} disabled={saving !== null || !data}>
            {editingId
              ? t("adminMiscRoutes.customMeta.saveChanges")
              : t("adminMiscRoutes.customMeta.add")}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card overflow-hidden">
        <h2 className="text-sm font-semibold px-4 py-3 border-b border-border">
          {t("adminMiscRoutes.customMeta.definedFields")}
        </h2>
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">...</div>
        ) : error && !data ? (
          // Nieudany odczyt to nie „Brak definicji.” - ten napis zachęcał do
          // dodania klucza, który już istnieje.
          <div role="alert" className="p-4 text-sm text-destructive">
            {error.message || t("adminMiscRoutes.customMeta.genericError")}
          </div>
        ) : defs.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {t("adminMiscRoutes.customMeta.empty")}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {defs.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground w-10">
                  {d.position}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">
                    {d.label_pl || d.label_en || d.key}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {t("adminMiscRoutes.customMeta.iconMeta", { key: d.key, icon: d.icon })}
                  </div>
                </div>
                {/* Lista trzyma ten wiersz sprzed trwającego zapisu: wczytany teraz
                    formularz przeżyłby zapis, a kolejne „Zapisz zmiany” cofało go. */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => edit(d)}
                  disabled={saving?.id === d.id}
                >
                  {t("adminMiscRoutes.customMeta.edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(d.id)}
                  className="text-destructive"
                >
                  {t("adminMiscRoutes.customMeta.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
