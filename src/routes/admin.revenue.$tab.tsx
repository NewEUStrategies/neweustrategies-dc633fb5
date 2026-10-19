// /admin/revenue/$tab - zakładki huba poza kokpitem.
//
// JEDNA TRASA Z PARAMETREM, A NIE DZIESIĘĆ PLIKÓW. Lista zakładek mieszka
// w `REVENUE_TABS` (`lib/revenue/search.ts`); powłoka tej trasy odrzuca adres
// spoza listy, daje każdej zakładce SEKCYJNY nagłówek, a treść wybiera
// `RevenueTabOutlet` z mapy leniwych chunków.
//
// ODMOWA W `beforeLoad`, NIE W `params.parse`. Router w tej wersji (1.170.x)
// nie ma w repo ani jednego precedensu `params.parse`, a `notFound()` rzucone
// z `beforeLoad` to zachowanie przypięte testem
// (`adminRevenueHubRoutes.test.tsx`). `overview` też jest 404: kokpit ma
// jeden adres - indeks huba.
//
// NAGŁÓWKI SĄ LITERAŁAMI (AGENTS: sekcyjne `adminPageHead` na ekranach
// admina). `Record` po typie zakładek pilnuje kompletu - nowa zakładka bez
// nagłówka nie skompiluje się, zamiast dostać w karcie przeglądarki ogólny
// tytuł huba. Słownik i18n nie wchodzi tu celowo: powłoka jedzie w chunku
// wejściowym każdej strony.
import { createFileRoute, notFound } from "@tanstack/react-router";

import { RevenueTabOutlet } from "@/components/admin/revenue/tabs/RevenueTabOutlet";
import { adminPageHead } from "@/lib/adminPageHead";
import { isRevenueTab, type RevenueTabId } from "@/lib/revenue/search";

type HubTab = Exclude<RevenueTabId, "overview">;

const HEADS: Record<HubTab, readonly [string, string]> = {
  mrr: [
    "Przychód i lejek - przychód",
    "MRR, ARR, most MRR, ruchy subskrypcji i przychód zrealizowany w każdej walucie.",
  ],
  funnel: [
    "Przychód i lejek - lejek",
    "Droga od odwiedzin przez konto, paywall i kasę do płacącego klienta.",
  ],
  retention: [
    "Przychód i lejek - retencja",
    "Odejścia klientów i przychodu, NRR i GRR, kohorty, anulowanie i windykacja.",
  ],
  community: [
    "Przychód i lejek - społeczność",
    "Przychód z biletów, obecność na wydarzeniach i lejek zgłoszeń do klubów.",
  ],
  diagnostics: [
    "Przychód i lejek - diagnostyka",
    "Wykryte problemy cennika, paywalla i lejka z dowodami, szybkie naprawy i mapa systemu.",
  ],
  offer: [
    "Przychód i lejek - oferta",
    "Drabina cen, macierz planów i benefitów, rabaty i kupony w jednym widoku.",
  ],
  access: [
    "Przychód i lejek - dostęp",
    "Polityka dostępu do treści, symulator czytelnika, limit darmowych artykułów i pomiar paywalla.",
  ],
  journeys: [
    "Przychód i lejek - ścieżki",
    "Ścieżki komunikacji: stan silnika, lista ścieżek, galeria szablonów i ustawienia.",
  ],
  metrics: [
    "Przychód i lejek - wskaźniki",
    "Słownik wskaźników z oceną, kontekstem benchmarku i źródłami danych.",
  ],
  inputs: [
    "Przychód i lejek - dane wejściowe",
    "Plan MRR, koszty i marże miesiąc po miesiącu, w podziale na segmenty klientów.",
  ],
};

/** Zakładka obsługiwana przez TĘ trasę: znana i nie kokpit. */
function isHubTab(raw: string): raw is HubTab {
  return isRevenueTab(raw) && raw !== "overview";
}

export const Route = createFileRoute("/admin/revenue/$tab")({
  beforeLoad: ({ params }) => {
    if (!isHubTab(params.tab)) throw notFound();
  },
  // Zapas na adres odrzucony: `head()` nie może rzucić, a tytuł huba jest
  // wtedy prawdą o miejscu (strona 404 i tak pokazuje własną treść).
  head: ({ params }) =>
    isHubTab(params.tab)
      ? adminPageHead(...HEADS[params.tab])
      : adminPageHead(
          "Przychód i lejek",
          "Cennik, paywall, lejek, retencja i ścieżki komunikacji w jednym miejscu.",
        ),
  component: RevenueTabRoute,
});

function RevenueTabRoute() {
  const { tab } = Route.useParams();
  // `beforeLoad` odrzucił już każdy inny adres; strażnik zawęża typ bez
  // rzutowania i nie renderuje niczego, gdyby kolejność kiedyś się zmieniła.
  return isHubTab(tab) ? <RevenueTabOutlet tab={tab} /> : null;
}
