// /admin/tracker-guide - dokumentacja panelu Trackera UE:
// jak dossier działa, co robi trigger DB oraz jak skonfigurować automatyczne
// wysyłki powiadomień/push (pg_cron -> /api/public/jobs-tick).
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin/tracker-guide")({
  component: TrackerGuidePage,
});

function TrackerGuidePage() {
  const { i18n } = useTranslation();
  const isPl = i18n.language !== "en";
  const L = (pl: string, en: string) => (isPl ? pl : en);

  const steps: Array<{ title: string; body: string }> = isPl
    ? [
        {
          title: "1. Utwórz dossier",
          body: "W /admin/tracker kliknij „Nowe dossier". Ustaw slug (URL), tytuły PL/EN, obszar polityki, etap, ważność (1-3) i status. Status „published" udostępnia dossier na /tracker; „draft" zostawia je tylko dla redakcji.",
        },
        {
          title: "2. Dodaj aktualizację / kamień milowy",
          body: "W trybie edycji dossier zjedź do sekcji „Oś czasu / Aktualizacja". Aktualizacja z ustawionym nowym etapem automatycznie przestawi etap dossier (trigger tg_eu_policy_update_applied) oraz wygeneruje powiadomienie kind='tracker' do obserwujących (eu_policy_follows) + wpis w kolejce push (notification_push_queue).",
        },
        {
          title: "3. Uruchom wysyłkę powiadomień",
          body: "Kolejka push jest opróżniana przez tick tła. Możesz uruchomić go ręcznie przyciskiem „Uruchom tick teraz" (na górze /admin/tracker) - wykonuje POST do endpointu z uprawnieniami service_role, przetwarza push jobs, digesty oraz przypomnienia o wydarzeniach.",
        },
        {
          title: "4. Skonfiguruj pg_cron (produkcja)",
          body: "W /admin/newsletter/campaigns w sekcji „Job runner" włącz przełącznik, ustaw base_url (stabilny URL projektu) i zapisz. Migracja utworzy zadanie pg_cron wywołujące POST /api/public/jobs-tick co minutę z sekretem z job_runner_settings. Bez tego kolejka rośnie i alerty czekają na manualny tick.",
        },
        {
          title: "5. Powiąż wpisy i pozycje krajów",
          body: "Zakładka „Powiązania" pozwala przypiąć artykuły/podcasty do dossier (eu_policy_links) - te linki pojawiają się na stronie publicznej. „Pozycje krajów" (eu_policy_positions) rysują mapę stanowisk państw UE (za/przeciw/neutralnie) - widoczną w /tracker/$slug.",
        },
      ]
    : [
        {
          title: "1. Create a dossier",
          body: "In /admin/tracker click 'New dossier'. Set the slug (URL), PL/EN titles, policy area, stage, importance (1-3) and status. Status 'published' exposes the dossier on /tracker; 'draft' keeps it staff-only.",
        },
        {
          title: "2. Add an update / milestone",
          body: "While editing a dossier, open the Timeline / Update section. An update with a new stage automatically moves the dossier stage (trigger tg_eu_policy_update_applied), enqueues notifications of kind='tracker' for followers (eu_policy_follows), and pushes a job onto notification_push_queue.",
        },
        {
          title: "3. Deliver the notifications",
          body: "The push queue is drained by a background tick. Trigger it manually with the 'Run tick now' button at the top of /admin/tracker - it runs with service_role, draining push jobs, digests and event reminders.",
        },
        {
          title: "4. Configure pg_cron (production)",
          body: "In /admin/newsletter/campaigns' 'Job runner' section enable the toggle, set base_url (stable project URL) and save. A migration schedules a pg_cron job calling POST /api/public/jobs-tick every minute with the secret stored in job_runner_settings. Without it the queue grows and alerts wait for a manual tick.",
        },
        {
          title: "5. Link items and country positions",
          body: "The 'Links' tab pins articles/podcasts to a dossier (eu_policy_links) - shown on the public page. 'Country positions' (eu_policy_positions) drive the EU stance map (for/against/neutral) on /tracker/$slug.",
        },
      ];

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
            {L("Tracker UE - jak to działa", "EU Tracker - how it works")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {L(
              "Krok po kroku: konfiguracja, przepływ danych i automatyczne alerty.",
              "Step by step: configuration, data flow and automated alerts.",
            )}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/admin/tracker">
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {L("Wróć do panelu", "Back to panel")}
          </Link>
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {L("Konfiguracja krok po kroku", "Step-by-step configuration")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {steps.map((s) => (
            <div key={s.title} className="flex gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <div className="font-medium">{s.title}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {L("Jak zachowuje się system", "How the system behaves")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {L(
              "Każde dossier (eu_policy_items) ma etap i status. Publikacja („published") pokazuje je na /tracker; szkic („draft") jest ukryty na powierzchni publicznej dzięki RLS.",
              "Every dossier (eu_policy_items) has a stage and a status. 'published' exposes it on /tracker; 'draft' is hidden from public surfaces by RLS.",
            )}
          </p>
          <p>
            {L(
              "Dodanie aktualizacji (eu_policy_updates) z etapem uruchamia trigger, który: (a) aktualizuje pole stage w dossier, (b) emituje domain event `policy.updated.v1` (realtime), (c) wpisuje powiadomienia dla obserwujących.",
              "Adding an update (eu_policy_updates) with a stage fires a trigger that (a) updates the dossier stage, (b) emits the `policy.updated.v1` domain event (realtime), (c) enqueues notifications for followers.",
            )}
          </p>
          <p>
            {L(
              "Endpoint /api/public/jobs-tick (autoryzowany sekretem z job_runner_settings) drenuje kolejkę push i wysyła digesty. W dev odpalisz go ręcznie przyciskiem „Uruchom tick teraz".",
              "The /api/public/jobs-tick endpoint (secret-authorized via job_runner_settings) drains the push queue and dispatches digests. In dev run it via the 'Run tick now' button.",
            )}
          </p>
          <p>
            {L(
              "Statystyki z /tracker (liczba dossier, rozkład etapów/obszarów) pochodzą z RPC get_tracker_stats - odświeżają się automatycznie przez React Query po każdej zmianie.",
              "The /tracker stats (dossier counts, stage/area breakdown) come from the get_tracker_stats RPC and refresh automatically via React Query after every mutation.",
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
