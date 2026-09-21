// Organizm: pola formularza zapisu jednego wydarzenia.
//
// USUNIĘCIE POLA NIE KASUJE ODPOWIEDZI. Złożone zgłoszenia trzymają odpowiedzi w
// JSON-ie pod kluczem pola, więc definicja może zniknąć, a treść zostaje - i to
// jest właściwe zachowanie, ale trzeba je powiedzieć wprost w potwierdzeniu.
//
// PYTANIE KWALIFIKUJĄCE MA ZNACZNIK W WIERSZU. Pole, które odrzuca zgłoszenia
// automatycznie, nie może wyglądać jak zwykłe pytanie o stanowisko.
//
// WIERSZ NAZYWA SIEBIE W KAŻDEJ AKCJI. Przełącznik „aktywne" i potwierdzenie
// usunięcia dotyczą JEDNEGO pytania z kilkunastu, a ikona kosza i przełącznik
// wyglądają w każdym wierszu tak samo. Dlatego obie akcje niosą etykietę
// I KLUCZ pola: klucz jest tu tożsamością (niezmienny, unikalny w wydarzeniu),
// a etykieta bywa w dwóch pytaniach ta sama.
//
// POLE ZGODY POKAZUJE OBA SWOJE DOKUMENTY. `consent_url_pl` i `consent_url_en`
// są opcjonalne (kolumny z DEFAULT ''), a obie wersje wchodzą do formularza
// uczestnika - pole z dokumentem wyłącznie po polsku wyglądało na liście
// dokładnie tak samo jak pole z kompletem, więc uczestnik anglojęzyczny
// dostawał pytanie o zgodę bez treści, na którą się godzi.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AdminCatalogListState } from "@/components/admin/molecules/AdminCatalogListState";
import { RegistrationFieldDialog } from "@/components/admin/events/molecules/RegistrationFieldDialog";
import { adminRegistrationErrorMessage } from "@/lib/events/adminRegistrationErrors";
import { fieldDraftFromRow, fieldDraftToInput } from "@/lib/events/registrationFieldDraft";
import type {
  EventRegistrationFieldRow,
  RegistrationFieldInput,
} from "@/lib/events/registrationsApi";
import {
  useDeleteRegistrationField,
  useRegistrationFields,
  useSaveRegistrationField,
} from "@/lib/events/useEventRegistrations";

export function RegistrationFieldsPanel({ eventId }: { eventId: string }) {
  const { t, i18n } = useTranslation();
  const listQ = useRegistrationFields(eventId);
  const save = useSaveRegistrationField(eventId);
  const remove = useDeleteRegistrationField(eventId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [edited, setEdited] = useState<EventRegistrationFieldRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EventRegistrationFieldRow | null>(null);

  const rows = listQ.data ?? [];
  const nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sort_order ?? 0), 90) + 10;

  /** Etykieta pytania w języku interfejsu - ta sama w wierszu, w przełączniku i w oknie. */
  const fieldLabel = (row: EventRegistrationFieldRow): string =>
    i18n.language.startsWith("pl") ? row.label_pl : row.label_en;

  /**
   * Liczba złożonych odpowiedzi. Kolumna wraca z RPC jako NULL-owalna (generator
   * typów opisuje `RETURNS TABLE` jako niepustą), a brak znaczy tu ZERO, nie puste
   * miejsce - jedno wejście, żeby wiersz i potwierdzenie liczyły tak samo.
   */
  const answersCount = (row: EventRegistrationFieldRow): number => row.answers_count ?? 0;

  const fail = (error: unknown) => toast.error(adminRegistrationErrorMessage(error));

  const submit = (input: RegistrationFieldInput) => {
    save.mutate(input, {
      onSuccess: () => {
        toast.success(t("adminEventRegistration.form.toasts.saved"));
        setDialogOpen(false);
        setEdited(null);
      },
      onError: fail,
    });
  };

  const toggleActive = (row: EventRegistrationFieldRow, next: boolean) => {
    save.mutate(
      { ...fieldDraftToInput(fieldDraftFromRow(row), eventId), isActive: next },
      {
        onError: fail,
      },
    );
  };

  const confirmDelete = () => {
    if (pendingDelete === null) return;
    remove.mutate(pendingDelete.id, {
      onSuccess: () => {
        toast.success(t("adminEventRegistration.form.toasts.deleted"));
        setPendingDelete(null);
      },
      onError: (error) => {
        fail(error);
        setPendingDelete(null);
      },
    });
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("adminEventRegistration.form.title")}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("adminEventRegistration.form.subtitle")}
          </p>
        </div>
        <Button
          onClick={() => {
            setEdited(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          {t("adminEventRegistration.form.addAction")}
        </Button>
      </header>

      <AdminCatalogListState
        isLoading={listQ.isLoading}
        loadingLabel={t("adminEventRegistration.form.loading")}
        errorMessage={listQ.error === null ? null : adminRegistrationErrorMessage(listQ.error)}
        isEmpty={rows.length === 0}
        emptyLabel={t("adminEventRegistration.form.empty")}
      >
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-[14rem] flex-1">
                <p className="font-medium">{fieldLabel(row)}</p>
                <p className="font-medium tracking-tight text-xs text-muted-foreground">
                  {row.key}
                </p>
              </div>

              <Badge variant="secondary">
                {t(`adminEventRegistration.fieldTypes.${row.field_type}`)}
              </Badge>

              {row.is_required ? (
                <Badge variant="outline">{t("adminEventRegistration.form.columns.required")}</Badge>
              ) : null}

              {row.is_qualifying ? (
                <Badge>{t("adminEventRegistration.form.columns.qualifying")}</Badge>
              ) : null}

              {row.field_type === "consent" ? (
                <div className="min-w-[16rem] flex-1 space-y-0.5 text-xs">
                  <ConsentDocumentLine
                    label={t("adminEventRegistration.form.editor.consentUrlPl")}
                    url={row.consent_url_pl}
                    missingLabel={t("adminEventRegistration.form.editor.consentUrlMissing")}
                  />
                  <ConsentDocumentLine
                    label={t("adminEventRegistration.form.editor.consentUrlEn")}
                    url={row.consent_url_en}
                    missingLabel={t("adminEventRegistration.form.editor.consentUrlMissing")}
                  />
                </div>
              ) : null}

              <div className="min-w-[7rem] text-sm text-muted-foreground">
                {t("adminEventRegistration.form.columns.answers")}: {answersCount(row)}
              </div>

              <Switch
                checked={row.is_active}
                onCheckedChange={(next) => toggleActive(row, next)}
                aria-label={t("adminEventRegistration.form.editor.activeToggle", {
                  label: fieldLabel(row),
                  key: row.key,
                })}
              />

              <Button
                variant="ghost"
                size="icon"
                aria-label={t("adminEventRegistration.form.editor.editTitle")}
                onClick={() => {
                  setEdited(row);
                  setDialogOpen(true);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("adminEventRegistration.form.editor.deleteAction")}
                onClick={() => setPendingDelete(row)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      </AdminCatalogListState>

      <RegistrationFieldDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        eventId={eventId}
        field={edited}
        nextSortOrder={nextSortOrder}
        isSaving={save.isPending}
        onSubmit={submit}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("adminEventRegistration.form.editor.deleteAction")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("adminEventRegistration.form.editor.deleteConfirm")}
            </AlertDialogDescription>
            {/* PRZEDMIOT USUNIĘCIA, A NIE SAMO ZDANIE OGÓLNE. Ikony kosza są
                w każdym wierszu identyczne, a usunięcie nie ma cofnięcia -
                okno musi powtórzyć etykietę, klucz i liczbę odpowiedzi, które
                właśnie osieroci. */}
            {pendingDelete === null ? null : (
              <p className="rounded-md bg-muted px-3 py-2 text-sm">
                {t("adminEventRegistration.form.editor.deleteSubject", {
                  label: fieldLabel(pendingDelete),
                  key: pendingDelete.key,
                  answers: answersCount(pendingDelete),
                })}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("adminEventRegistration.form.editor.cancelAction")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={remove.isPending}>
              {t("adminEventRegistration.form.editor.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/**
 * Jedna wersja językowa dokumentu zgody w wierszu listy.
 *
 * BRAK DOKUMENTU JEST TREŚCIĄ, a nie pustym miejscem: uczestnik czytający
 * formularz w tym języku dostaje pytanie o zgodę bez treści, na którą się
 * godzi. Adres pokazujemy w całości - to on jest tu jedyną informacją, a
 * skrócony wygląda jak adres poprawny.
 */
function ConsentDocumentLine({
  label,
  url,
  missingLabel,
}: {
  label: string;
  url: string;
  missingLabel: string;
}) {
  const missing = url.trim() === "";
  return (
    <p className={missing ? "break-all text-amber-600 dark:text-amber-400" : "break-all"}>
      {label}: {missing ? missingLabel : url}
    </p>
  );
}
