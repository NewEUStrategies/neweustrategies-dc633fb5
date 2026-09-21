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

const loadAdminDashboard = () => import("@/components/admin/dashboard/AdminDashboard");

const AdminDashboard = lazy(() =>
  loadAdminDashboard().then((m) => ({ default: m.AdminDashboard })),
);

export const Route = createFileRoute("/admin/")({
  // ROZGRZEWKA CHUNKU PULPITU W `loader`, A NIE W CIELE MODUŁU. Ta różnica
  // kosztowała 434 kB na publicznej stronie głównej, więc jest tu opisana
  // razem z dowodem.
  //
  // ŁAŃCUCH, KTÓRY TO ROZCINA. `/admin` renderuje na serwerze wyłącznie szkielet
  // powłoki, a `AdminSession` (routes/admin.tsx) przy `useAuth().loading` NIE
  // renderuje `<Outlet/>`.
  // Komponent tej trasy montuje się więc dopiero PO rozstrzygnięciu sesji,
  // a `React.lazy` odpala import przy pierwszym renderze. Szeregowo wychodziło:
  //   1. `supabase.auth.getSession()` - localStorage, przy wygasłym tokenie
  //      dodatkowo odświeżenie po sieci;
  //   2. `loadContext(uid)` - dwa zapytania PostgREST (`user_roles`, `profiles`);
  //      `loading` schodzi dopiero po nich (hooks/useAuth.tsx);
  //   3. dopiero teraz pobranie chunku pulpitu (silnik wykresów + mapa);
  //   4. sześć zapytań pulpitu; 5. malowanie.
  // Zmierzone na produkcji LCP `/admin` = 7,54 s. Faza 3 nie zależy od faz 1-2.
  //
  // DLACZEGO NIE W CIELE MODUŁU - ZMIERZONE, NIE PRZEWIDZIANE. Pierwsze podejście
  // wołało rozgrzewkę przy ewaluacji modułu trasy, w założeniu, że router
  // ewaluuje moduł tylko dla DOPASOWANEJ trasy. To jest nieprawda: bramka
  // `first-visit` na zbudowanym artefakcie pokazała, że wejście na `/` ściąga
  // moduły kilkunastu niedopasowanych tras (`author.$slug`, `admin.crop-sizes`,
  // `podcasts.$show`, `events.$slug_.packages`...), a razem z nimi poleciał cały
  // silnik wykresów: `Chart` 216 kB, `ChartFrame` 74 kB, `i18n-admin-analytics`
  // 58 kB, `AdminDashboard`, `useDashboardData`, `geoQuery`, `DataVizViews`.
  // Suma: jsBytes 3 070 809 -> 3 504 909 na PUBLICZNEJ stronie głównej, czyli
  // dokładne złamanie zasady z nagłówka tego pliku.
  //
  // `loader` biegnie WYŁĄCZNIE dla dopasowanej trasy - i biegnie przy
  // rozwiązywaniu dopasowania, czyli zanim React zamontuje `AuthProvider`
  // i zanim ruszy faza 1. Daje więc tę samą równoległość bez wycieku.
  // Kontrola negatywna jest przypięta testem (`adminDashboardRoute.test.tsx`):
  // sam import modułu NIE MOŻE żądać chunku, a `loader` MUSI.
  //
  // KOSZT, wprost: osoba bez uprawnień wchodząca na `/admin` pobierze ten chunk,
  // zanim `AdminLayout` przekieruje ją na `/login`. Świadomie bez bramki -
  // jedyna synchroniczna wymagałaby czytania wewnętrznego klucza sesji Supabase
  // z `localStorage`, a `/admin` jest noindex i na deny-liście cache'u.
  loader: () => {
    // Od 2026-09-20 `/admin` renderuje na serwerze szkielet powłoki (routes/admin.tsx),
    // więc ten loader biegnie także w SSR - tam import chunku pulpitu nie ma
    // pożytku (pulpit montuje się dopiero po sesji w przeglądarce), a kosztuje
    // ewaluację silnika wykresów w izolacie. Rozgrzewka wyłącznie po stronie klienta.
    if (typeof document === "undefined") return;
    void loadAdminDashboard().catch(() => undefined);
  },
  component: Dashboard,
});

function Fallback() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      // REZERWA JEDNEGO EKRANU, nie `py-16`. Ta migotka stoi na czas dociągania
      // chunku pulpitu, po którym w jej miejscu wyrasta kilka ekranów sekcji.
      // Bez rezerwy pasek kondycji platformy (`AdminBiStrip`) maluje się tuż
      // pod nagłówkiem i po chwili zjeżdża o wysokość całego pulpitu - jedno
      // z największych pojedynczych przesunięć układu na `/admin`.
      // 70vh, a nie pełna wysokość pulpitu: tej drugiej nie da się poznać przed
      // odczytem danych (liczba sekcji zależy od wybranego okna czasu), a
      // rezerwa większa od potrzebnej produkuje przesunięcie w drugą stronę.
      className="flex min-h-[70vh] items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
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

  // ZASIĘG TYPOGRAFII MOTYWU STOI NA TRASIE, nie w leniwym komponencie, i to
  // jest różnica zachowania, a nie porządki. Wewnątrz `AdminDashboard` obejmuje
  // sam pulpit, a pasek kondycji pod nim zostaje POZA nim - czyli dwa bloki
  // jednego ekranu składałyby się innym krojem i innym rytmem linii. Bramka
  // `themeTypographyScope` sprawdza ten plik właśnie dlatego, że to on jest
  // korzeniem widoku.
  return (
    <div data-theme-typography>
      <Suspense fallback={<Fallback />}>
        <AdminDashboard />
      </Suspense>

      {/* KONDYCJA PLATFORMY zostaje na dole i zostaje świadomie: Web Vitals
          i błędy przeglądarki to jedyny sygnał, że strona, której ruch pokazuje
          pulpit, w ogóle działa. Nad nimi stoją teraz pytania biznesowe, a nie
          odwrotnie - ale usunięcie ich byłoby stratą, nie uproszczeniem. */}
      <AdminBiStrip days={14} className="mt-6" />
    </div>
  );
}
