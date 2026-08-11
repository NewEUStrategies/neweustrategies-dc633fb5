// Trasa układu dla całego modułu klubów (/club/*).
//
// PO CO ONA ISTNIEJE. `community_modules.clubs_enabled` był od A1 przełącznikiem
// bez skutku: panel go zapisywał, panel pokazywał stan "wyłączony", a `/club`
// działało dalej dokładnie tak samo. Przełącznik, który niczego nie przełącza,
// jest gorszy niż jego brak - administrator ma dowód (zapisany stan), że moduł
// jest wyłączony, i nie ma powodu tego sprawdzać.
//
// Bramka siedzi w trasie UKŁADU, a nie w siedmiu komponentach tras, z jednego
// konkretnego powodu: `<Outlet />` niezrenderowany to dzieci NIEZAMONTOWANE,
// czyli zero wywołań `club_list`, `club_activity_feed` i reszty. Warunek
// wpisany w każdą trasę z osobna zatrzymywałby rysowanie, ale nie zapytania -
// wyłączony moduł nadal pukałby do bazy przy każdym wejściu.
//
// Bramka jest UI-owa, nie bezpieczeństwem: dostępu pilnują RLS i SECURITY
// DEFINER RPC. Ta odpowiada na inne pytanie - czy tenant W OGÓLE prowadzi
// kluby dyskusyjne.
//
// Mapa `site_settings` jest rozgrzana przez loader trasy głównej
// (`ensureQueryData(siteSettingsQueryOptions)`), więc odczyt tutaj nie kosztuje
// round-tripu i nie ma stanu "jeszcze nie wiem" - inaczej domyślne `false`
// mrugałoby ekranem "moduł wyłączony" przy każdym wejściu.
import { Suspense, lazy } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { RouteErrorFallback } from "@/components/molecules/RouteErrorFallback";
import { useClubsModule } from "@/lib/clubs/useClubsModule";
import { ClubNavyTheme } from "@/components/clubs/atoms/ClubNavyTheme";

// Ekran "moduł wyłączony" jest LENIWY, i to nie z ostrożności. `CommunityDisabled`
// importuje `@/lib/i18n-community` w module top-level, a ta trasa jest rodzicem
// KAŻDEJ strony /club/*: import statyczny dokładałby ~5,5 KB gzip słownika
// społeczności do ścieżki krytycznej każdego wejścia do klubu - po to, żeby mieć
// pod ręką ekran, którego przy włączonym module nikt nigdy nie zobaczy.
const CommunityDisabled = lazy(() =>
  import("@/components/community/CommunityDisabled").then((m) => ({
    default: m.CommunityDisabled,
  })),
);

export const Route = createFileRoute("/club")({
  component: ClubModuleLayout,
  // Granice błędu i ładowania dla CAŁEJ rodziny tras. Moduł polegał na
  // domyślnych granicach routera - w odróżnieniu od reszty rodzin tras - więc
  // wyjątek w loaderze wątku dawał surowy ekran routera zamiast strony błędu
  // serwisu. Trasa układu jest jedynym miejscem, w którym trzeba to wpisać raz:
  // granica rodzica łapie każde dziecko, a siedem kopii tej samej deklaracji
  // rozjechałoby się przy pierwszej zmianie.
  errorComponent: ClubRouteError,
  pendingComponent: ClubRoutePending,
});

function ClubRouteError(props: Parameters<typeof RouteErrorFallback>[0]) {
  return <RouteErrorFallback {...props} />;
}

/** Szkielet w rytmie strony klubu (nagłówek + lista), nie pusty ekran. */
function ClubRoutePending() {
  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8 py-8" aria-busy="true">
      <div className="mb-6 h-40 animate-pulse rounded-lg bg-muted/50" />
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/40" />
        ))}
      </div>
    </div>
  );
}

function ClubModuleLayout() {
  const { disabled } = useClubsModule();
  if (disabled) {
    return (
      <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
        <CommunityDisabled />
      </Suspense>
    );
  }
  // `data-club-typography` włącza skalę typografii z Admin → Opcje motywu →
  // Rozmiary dla całego modułu (mapowanie utility → tokeny w styles.css).
  // `data-club-neutral` mapuje `--primary` na neutralny grafit/popiel, żeby
  // moduł nie świecił pomarańczem marki w każdym kaflu (patrz styles.css).
  return (
    <div data-club-typography data-club-neutral>
      {/* Cały moduł klubów w trybie ciemnym jedzie na granacie ze złotem. */}
      <ClubNavyTheme />
      <Outlet />
    </div>
  );
}
