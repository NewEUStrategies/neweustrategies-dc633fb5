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

// POBRANIE CHUNKU STARTUJE TUTAJ, NIE PRZY RENDERZE - i to jest jedna linijka
// warta sekund w LCP, więc należy jej się akapit.
//
// ŁAŃCUCH, KTÓRY TO ROZCINA. `/admin` to trasa `ssr: false`, a `AdminLayout`
// (routes/admin.tsx) przy `useAuth().loading` NIE renderuje `<Outlet/>`. Ten
// komponent montuje się więc dopiero PO rozstrzygnięciu sesji - a `React.lazy`
// odpala swój import przy pierwszym renderze. Przed zmianą wyglądało to tak,
// SZEREGOWO:
//   1. `supabase.auth.getSession()` - odczyt localStorage, a przy wygasłym
//      tokenie DODATKOWO odświeżenie po sieci;
//   2. `loadContext(uid)` - dwa zapytania PostgREST (`user_roles`, `profiles`);
//      `loading` schodzi dopiero po nich (hooks/useAuth.tsx: `loading =
//      sessionLoading || (session !== null && rolesLoading)`);
//   3. DOPIERO TERAZ pobranie chunku pulpitu (silnik wykresów + mapa);
//   4. sześć zapytań pulpitu;
//   5. malowanie.
// Zmierzone na produkcji LCP `/admin` = 7,54 s. Faza 3 nie zależy od faz 1-2
// w ŻADEN sposób - to czysta serializacja.
//
// Moduł trasy jest ewaluowany przez router przy rozwiązywaniu dopasowania,
// czyli ZANIM zacznie się faza 1. Ten `void` przenosi więc fazę 3 równolegle
// do faz 1-2, nie dotykając ani `Suspense`, ani podziału na chunki: pulpit
// nadal NIE wchodzi do grafu startowego (to była intencja `lazy` i zostaje).
//
// KOSZT, wprost: osoba BEZ uprawnień, która wejdzie na `/admin`, pobierze ten
// chunk, zanim `AdminLayout` przekieruje ją na `/login`. Świadomie nie
// stawiamy tu bramki: jedyny synchroniczny sposób jej postawienia to czytanie
// wewnętrznego klucza sesji Supabase z `localStorage`, czyli sprzęgnięcie się
// z formatem, którego nie kontrolujemy - a `/admin` jest noindex i na
// deny-liście cache'u, więc ruch spoza redakcji jest tu marginalny.
if (typeof window !== "undefined") void loadAdminDashboard().catch(() => undefined);

export const Route = createFileRoute("/admin/")({
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
