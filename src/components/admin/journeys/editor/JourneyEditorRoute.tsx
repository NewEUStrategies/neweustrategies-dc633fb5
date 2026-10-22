// Edytor ścieżki komunikacji (`/admin/revenue/journeys/$journeyId`) - powłoka
// komponentu trasy (S8): bramka roli, stan przed hydratacją, widok domyślny,
// nawigacja po adresie edytora i leniwy chunk właściwego edytora.
//
// WŁASNE `ensureI18n()` I WŁASNA BRAMKA ROLI. Trasa edytora jest WYPIĘTA
// z układu huba (`admin.revenue_.journeys…` - kanwa potrzebuje całej
// szerokości, bez nagłówka i paska zakładek), więc nie dziedziczy ani
// rejestracji słownika, ani sprawdzenia roli z `RevenueHubLayout`. Warunek jest
// ten sam co w układzie: wiersz `admin` albo `editor`, nie `isAdmin` (ten liczy
// też `super_admin`, którego polityki ścieżek nie wpuszczają - edytor byłby
// pusty). Co dokładnie wolno w środku (publikacja, pominięcie czekania),
// mówią `journeyCapabilities(roles)` - te same dokładne role. Autorytetem
// pozostaje baza.
//
// `journeyId` i `search` przychodzą z powłoki trasy (`Route.useParams()`,
// `Route.useSearch()` po `parseJourneyEditorSearch`), a nie z hooków routera
// tutaj: komponent nie zna swojej trasy, więc da się go zamontować w teście
// i w podglądzie bez routera. Zmianę adresu (widok, krok, okno statystyk,
// wersja) robi `useNavigate` na `/admin/revenue/journeys/$journeyId`.
//
// NAWIGACJA W OBRĘBIE EDYTORA OMIJA STRAŻNIKA ZMIAN. Sesja szkicu trzyma
// `useUnsavedChangesGuard(isDirty)`, a strażnik routera blokuje KAŻDĄ
// nawigację - także samą zmianę `?node=` przy otwieraniu panelu kroku przez
// 2 s autozapisu. Edytor zostaje przy tym zamontowany i nic nie traci, więc
// zmiany adresu edytora idą z `ignoreBlocker`; wyjście z edytora (okruszki,
// pasek boczny, zamknięcie karty) strażnik pilnuje dalej.
//
// WIDOK DOMYŚLNY (SPEC §6.3 „A11y”): bez `?view=` - Lista na ekranie węższym
// niż 768 px i przy `prefers-reduced-motion`, inaczej Kanwa. Oba sygnały
// czytamy dopiero po hydratacji (serwer nie zna okna), a `data-view` mówi,
// który widok faktycznie stoi.
//
// LENIWY CHUNK (D-08). Kanwa, lista, sesja szkicu i pasek jadą w osobnym
// chunku `JourneyEditor` - powłoka trasy niesie wyłącznie bramkę i granicę
// `Suspense` z tym samym stanem „wczytywanie” co zakładki huba.
import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useHydrated, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { useAuth } from "@/hooks/useAuth";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { journeyCapabilities } from "@/lib/admin/journeys/access";
import { ensureI18n } from "@/lib/i18n-admin-revenue";
import type { JourneyEditorSearch, JourneyEditorView } from "@/lib/journeys/editorSearch";

const JourneyEditor = lazy(() =>
  import("./JourneyEditor").then((m) => ({ default: m.JourneyEditor })),
);

/** Próg widoku Lista (SPEC §6.3): poniżej 768 px kanwa jest za wąska. */
const NARROW_VIEWPORT_QUERY = "(max-width: 767px)";

/** Wąskie okno - `false` na serwerze i w pierwszym renderze (hydratacja bez rozjazdu). */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
    setNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function JourneyEditorRoute({
  journeyId,
  search,
}: {
  journeyId: string;
  search: JourneyEditorSearch;
}) {
  ensureI18n();
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const { roles, tenantId } = useAuth();
  const navigate = useNavigate();
  const reducedMotion = usePrefersReducedMotion();
  const narrow = useNarrowViewport();
  const view: JourneyEditorView = search.view ?? (narrow || reducedMotion ? "list" : "canvas");

  const onSearchChange = useCallback(
    (patch: Partial<JourneyEditorSearch>, options?: { replace?: boolean }) => {
      const next: JourneyEditorSearch = { ...search, ...patch };
      // Pusty parametr znika z adresu (jak w zakładce Ścieżki), a nie zostaje
      // jako `?node=undefined`.
      for (const key of Object.keys(next) as (keyof JourneyEditorSearch)[]) {
        if (next[key] === undefined) delete next[key];
      }
      void navigate({
        to: "/admin/revenue/journeys/$journeyId",
        params: { journeyId },
        search: next,
        replace: options?.replace,
        ignoreBlocker: true,
      });
    },
    [journeyId, navigate, search],
  );

  if (!hydrated) return <RevenueTabPending />;

  if (!(roles.includes("admin") || roles.includes("editor"))) {
    return (
      <p role="status" data-testid="revenue-role-gate" className="text-sm text-muted-foreground">
        {t("adminRevenue.common.roleGate")}
      </p>
    );
  }

  return (
    <section
      data-testid="journey-editor"
      data-journey-id={journeyId}
      data-view={view}
      className="space-y-4"
    >
      <Suspense fallback={<RevenueTabPending />}>
        <JourneyEditor
          journeyId={journeyId}
          search={search}
          view={view}
          capabilities={journeyCapabilities(roles)}
          // Atrapa sesji w testach I0 nie podaje najemcy - `undefined` = brak.
          tenantId={tenantId ?? null}
          onSearchChange={onSearchChange}
        />
      </Suspense>
    </section>
  );
}
