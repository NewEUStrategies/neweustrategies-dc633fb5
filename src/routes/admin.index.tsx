// Strona startowa panelu - KOKPIT.
//
// TRASA JEST CIENKA CELOWO. Cały pulpit (silnik wykresów, mapa choropletowa,
// sześć zapytań) siedzi w `AdminDashboard` i jest ładowany LENIWIE, więc wejście
// na /admin nie ciągnie za sobą rysunków, zanim cokolwiek się pokaże. To ta sama
// zasada, co w /admin/analytics/bi: silnik nigdy nie wchodzi do grafu startowego.
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

import { ensureI18n } from "@/lib/i18n-admin-dashboard";
import { AdminBiStrip } from "@/components/admin/analytics/AdminBiStrip";

const AdminDashboard = lazy(() =>
  import("@/components/admin/dashboard/AdminDashboard").then((m) => ({
    default: m.AdminDashboard,
  })),
);

export const Route = createFileRoute("/admin/")({
  component: Dashboard,
});

function Fallback() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
    >
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      {t("adminDashboard.state.loading")}
    </div>
  );
}

function Dashboard() {
  // Słownik rejestrujemy JUŻ W TRASIE, nie dopiero w leniwym komponencie -
  // inaczej migotka pod spodem wypisałaby surowy klucz zamiast "Wczytywanie".
  ensureI18n();

  return (
    <>
      <Suspense fallback={<Fallback />}>
        <AdminDashboard />
      </Suspense>

      {/* KONDYCJA PLATFORMY zostaje na dole i zostaje świadomie: Web Vitals
          i błędy przeglądarki to jedyny sygnał, że strona, której ruch pokazuje
          pulpit, w ogóle działa. Nad nimi stoją teraz pytania biznesowe, a nie
          odwrotnie - ale usunięcie ich byłoby stratą, nie uproszczeniem. */}
      <AdminBiStrip days={14} className="mt-6" />
    </>
  );
}
