// Organizm: EKRAN KLONU EDYCJI (`/admin/events/new?from=<id>`).
//
// DRUGA DROGA TWORZENIA, TA SAMA RAMA. Klon rysuje się w `EventStudioCreateShell`
// jak kreator z rodzaju: rail pokazuje tytuł i termin WPISYWANE w formularzu,
// więc przejście do studia nowej edycji nie przesuwa nagłówka nawigacji.
//
// BRAMKA ROLI JEST W BAZIE. `admin_event_clone` stoi za
// `assert_event_admin_tenant()` - redaktor dostałby odmowę po wypełnieniu
// formularza. Zdanie zamiast formularza istnieje po to, żeby odmowa nie
// wyglądała na awarię, a nie po to, żeby cokolwiek zabezpieczać.
//
// JEDEN KLUCZ IDEMPOTENCJI NA EKRAN. Klucz powstaje raz (`useState`), więc
// podwójne kliknięcie, ponowienie po zerwanym połączeniu i powrót „wstecz"
// z ponownym zapisem dostają TĘ SAMĄ nową edycję (`replayed`), a nie drugą
// kopię. Nieudany klon cofa w bazie także zajęcie klucza, więc poprawiony
// formularz może spróbować ponownie z tym samym kluczem.
//
// PO KLONIE IDZIEMY NA PULPIT NOWEJ EDYCJI - tak jak po utworzeniu z rodzaju.
// Podsumowanie (co skopiowano, co pominięto, na co uważać) czeka tam w cache
// (`useCloneEvent` wpisuje wynik), a toast mówi tylko, że się udało.
import { useCallback, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Lock } from "@/lib/lucide-shim";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { EventCloneForm } from "@/components/admin/events/organisms/EventCloneForm";
import { EventStudioCreateShell } from "@/components/admin/events/studio/EventStudioCreateShell";
import { adminCloneErrorMessage } from "@/lib/events/adminCloneErrors";
import type { EventCloneInput } from "@/lib/events/eventCloneApi";
import type { EventCloneDraft } from "@/lib/events/eventCloneDraft";
import { formatEventDateTime } from "@/lib/events/timezone";
import { useCloneEvent, useEventCloneSource } from "@/lib/events/useEventClone";
import { newIdempotencyKey } from "@/lib/http/idempotency";
import { pickLocalized } from "@/lib/i18n/pickLocalized";
import { uiLang } from "@/lib/i18n/format";
import { ensureCloneI18n } from "@/lib/i18n-admin-event-clone";

export function EventCloneScreen({ sourceId, canClone }: { sourceId: string; canClone: boolean }) {
  ensureCloneI18n();
  const { t, i18n } = useTranslation();
  const lang = uiLang(i18n.language);
  const navigate = useNavigate();
  const sourceQ = useEventCloneSource(canClone ? sourceId : "");
  const clone = useCloneEvent();
  const [idempotencyKey] = useState(() => newIdempotencyKey("event.clone"));
  const [rail, setRail] = useState({ title: "", date: "" });

  const reportDraft = useCallback(
    (draft: EventCloneDraft) =>
      setRail({
        title: pickLocalized({ title_pl: draft.titlePl, title_en: draft.titleEn }, "title", lang),
        date: formatEventDateTime(draft.startsAt, draft.timezone, lang),
      }),
    [lang],
  );

  if (!canClone) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
          <Lock className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t("adminEventClone.screen.adminOnly")}
        </CardContent>
      </Card>
    );
  }

  const submit = (input: EventCloneInput) => {
    clone.mutate(
      { ...input, idempotencyKey },
      {
        onSuccess: (result) => {
          toast.success(
            result.replayed
              ? t("adminEventClone.toasts.replayed")
              : t("adminEventClone.toasts.created", {
                  title: pickLocalized(
                    { title_pl: input.titlePl, title_en: input.titleEn },
                    "title",
                    lang,
                  ),
                }),
          );
          void navigate({
            to: "/admin/events/$eventId/overview",
            params: { eventId: result.eventId },
          });
        },
        onError: (error) => toast.error(adminCloneErrorMessage(error)),
      },
    );
  };

  return (
    <EventStudioCreateShell eventTitle={rail.title} startsAtLabel={rail.date}>
      <div className="w-full p-4 sm:p-6">
        {sourceQ.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("adminEventClone.screen.loading")}
          </p>
        ) : sourceQ.isError ? (
          <Card className="mx-auto w-full max-w-3xl">
            <CardContent className="space-y-2 p-6 text-sm">
              <p className="text-destructive" role="alert">
                {adminCloneErrorMessage(sourceQ.error)}
              </p>
              <Link to="/admin/events/new" className="text-brand hover:underline">
                {t("adminEventClone.screen.startFromScratch")}
              </Link>
            </CardContent>
          </Card>
        ) : (
          <EventCloneForm
            key={sourceId}
            source={sourceQ.data}
            isSaving={clone.isPending}
            onCancel={() => void navigate({ to: "/admin/events/list" })}
            onSubmit={submit}
            onDraftChange={reportDraft}
          />
        )}
      </div>
    </EventStudioCreateShell>
  );
}
