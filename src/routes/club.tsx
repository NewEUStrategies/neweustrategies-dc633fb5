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
import { useClubsModule } from "@/lib/clubs/useClubsModule";

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
});

function ClubModuleLayout() {
  const { disabled } = useClubsModule();
  if (disabled) {
    return (
      <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>
        <CommunityDisabled />
      </Suspense>
    );
  }
  return <Outlet />;
}
