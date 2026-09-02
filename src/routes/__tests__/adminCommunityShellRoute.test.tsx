// Powłoka `/admin/community` - dziewięć paneli modułu wisi na tych dziewięciu
// liniach.
//
// PO CO TEN PLIK ISTNIEJE. `src/routes/admin.community.tsx` był na dokładnym
// zerze pomiaru (0/9 linii). To jest cały plik: `head()`, `<CommunitySubNav/>`
// i `<Outlet/>` w kontenerze z odstępem. Wygląda na plik, którego nie ma po co
// testować - i dokładnie dlatego trzeba, bo każdy z tych trzech elementów psuje
// się CICHO:
//
//   1. `<Outlet/>`. W TanStack Router `Match` renderuje ALBO własny komponent
//      trasy, ALBO `<Outlet/>` - nigdy oba. Rodzic z własnym komponentem, który
//      zgubi `<Outlet/>`, montuje SIEBIE i na tym kończy: wszystkie dziewięć
//      podstron modułu znika z przeglądarki, choć ich trasy, loadery i testy
//      dalej istnieją i są zielone. Tak stracono kiedyś całe `/events` (patrz
//      `parentRoutesRenderOutlet.gate.test.ts`). Tamta bramka czyta ŹRÓDŁO
//      wszystkich rodziców naraz; ten plik dokłada dowód RENDEREM dla tej
//      jednej powłoki - montuje ją z prawdziwymi dziećmi i sprawdza, że pod
//      adresem podstrony widać PODSTRONĘ.
//   2. KOLEJNOŚĆ. Podnawigacja musi stać PRZED treścią. Pasek jest jedynym
//      wyjściem z panelu, w którym operator właśnie jest; wylądowanie go pod
//      tabelą na tysiąc wierszy to utrata nawigacji, nie kwestia estetyki.
//   3. `head()`. Bez tytułu wszystkie podstrony panelu są w historii
//      przeglądarki i na liście kart nieodróżnialne. `noindex, nofollow` jest
//      tu drugą warstwą po tym, że `/admin` w ogóle nie renderuje się bez
//      sesji - powłoka nie może zgubić żadnej z nich.
//
// GDZIE NAPRAWDĘ STOI BRAMKA UPRAWNIEŃ - USTALENIE, NIE ZAŁOŻENIE.
// TA TRASA NIE SPRAWDZA ROLI I NIE MA JEJ SPRAWDZAĆ. Sprawdziłem, gdzie ten
// warunek faktycznie mieszka:
//
//   1. `src/routes/admin.tsx` (wspólny layout `/admin`) - JEDYNA bramka
//      renderu dla wszystkich tras panelu: `useAuth()` daje `isStaff`, efekt
//      robi `navigate({ to: "/login" })`, a komponent zwraca `null`. Jedna
//      bramka zamiast stu czterdziestu kopii w trasach.
//   2. TA trasa - zero `useAuth`, zero `beforeLoad`, zero `redirect`.
//   3. Trasy potomne wrażliwsze niż reszta (rodzina `admin.community.clubs.*`)
//      dokładają WŁASNY warunek `isAdmin` z przetłumaczoną odmową - pilnuje
//      tego `adminRouteAuthority.gate.test.ts`.
//   4. Autorytet ostateczny to RLS i RPC w bazie (`is_club_admin`,
//      polityki `*_staff_*`), dowodzone w pgTAP.
//
// Dlatego nie ma tu testu „użytkownik bez roli nie widzi powłoki" udającego
// dowód na tym poziomie: taki test albo mierzyłby atrapę `useAuth`, której ta
// trasa nawet nie woła, albo przechodziłby zawsze. Zamiast tego są dwie
// asercje mierzące TO, CO JEST: render bez sesji (bo od roli nie zależy)
// i odczyt źródeł mówiący, gdzie warunek stoi naprawdę.
//
// CO JEST ATRAPOWANE I DLACZEGO. Wyłącznie `CommunitySubNav`: ma własny plik
// dowodowy (`src/components/admin/community/__tests__/CommunitySubNav.test.tsx`
// - dziewięć wpisów, wpis bieżący, plakietka kolejek, axe), a tutaj przedmiotem
// dowodu jest SKLEJENIE, czyli czy powłoka go montuje i w którym miejscu.
// Prawdziwy pasek wciągnąłby do tego pliku `useAuth` i licznik klubów, czyli
// dwie warstwy, o których ta trasa nic nie wie.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, screen } from "@testing-library/react";
import { createRoute, type AnyRoute } from "@tanstack/react-router";

vi.mock("@/components/admin/community/CommunitySubNav", () => ({
  CommunitySubNav: () => <nav data-testid="podnawigacja">podnawigacja</nav>,
}));

import { renderRoute, routeHead } from "@/test/routeHarness";
import { Route as CommunityShellRoute } from "@/routes/admin.community";

const SCIEZKA = "/admin/community";
const PLIK_POWLOKI = "src/routes/admin.community.tsx";
const PLIK_LAYOUTU_ADMINA = "src/routes/admin.tsx";

/**
 * Montuje powłokę Z DZIEĆMI. Same dzieci są zastępcze (produkcyjne ciągnęłyby
 * całą warstwę danych panelu), ale ich ŚCIEŻKI są produkcyjne - bez tego
 * `<Outlet/>` nie miałby czego wypuścić i asercja o nim byłaby pusta.
 *
 * `bezDzieci` jest potrzebne dokładnie jednemu testowi - patrz komentarz przy
 * nagłówku dokumentu.
 */
async function zamontujPowloke(wejscie: string, tryb: "z dziećmi" | "bez dzieci" = "z dziećmi") {
  const powloka: AnyRoute = CommunityShellRoute;
  powloka.addChildren(
    tryb === "bez dzieci"
      ? []
      : [
          createRoute({
            getParentRoute: () => powloka,
            path: "/",
            component: () => <div>PODSTRONA: pulpit</div>,
          }),
          createRoute({
            getParentRoute: () => powloka,
            path: "notifications",
            component: () => <div>PODSTRONA: powiadomienia</div>,
          }),
        ],
  );
  return renderRoute({ route: powloka, path: SCIEZKA, initialEntry: wejscie });
}

describe("/admin/community - powłoka wypuszcza podstrony", () => {
  it("pod adresem modułu renderuje PODSTRONĘ z `<Outlet/>`, a nie samą siebie", async () => {
    const widok = await zamontujPowloke(SCIEZKA);

    expect(widok.currentPath()).toBe(SCIEZKA);
    expect(screen.getByText("PODSTRONA: pulpit")).toBeInTheDocument();
    cleanup();
  });

  it("pod adresem podstrony montuje TĘ podstronę - i nie pulpit", async () => {
    // Druga strona tego samego dowodu: gdyby powłoka renderowała treść własną
    // zamiast `<Outlet/>`, oba adresy dawałyby ten sam ekran.
    await zamontujPowloke("/admin/community/notifications");

    expect(screen.getByText("PODSTRONA: powiadomienia")).toBeInTheDocument();
    expect(screen.queryByText("PODSTRONA: pulpit")).toBeNull();
    cleanup();
  });

  it("podnawigacja jest zamontowana i stoi PRZED treścią podstrony", async () => {
    const { container } = await zamontujPowloke("/admin/community/notifications");

    const pasek = screen.getByTestId("podnawigacja");
    const tresc = screen.getByText("PODSTRONA: powiadomienia");
    expect(container).toContainElement(pasek);
    // Kolejność jest treścią, nie estetyką: pasek to jedyne wyjście z panelu,
    // w którym operator właśnie stoi. Pod tabelą na tysiąc wierszy przestaje
    // istnieć.
    expect(pasek.compareDocumentPosition(tresc) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
  });

  it("powłoka NIE dokłada własnej treści poza paskiem i `<Outlet/>`", async () => {
    // Każdy napis dopisany tutaj pojawiłby się na WSZYSTKICH dziewięciu
    // podstronach naraz - i na żadnej nie byłby widoczny w jej własnym teście.
    await zamontujPowloke(SCIEZKA);

    expect(screen.getByTestId("podnawigacja").parentElement?.children).toHaveLength(2);
    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    cleanup();
  });
});

describe("/admin/community - nagłówek dokumentu", () => {
  it("`head()` daje tytuł karty i `noindex, nofollow`", async () => {
    // Dwiema drogami: wprost (kontrakt funkcji) i przez zamontowany router
    // (to, co faktycznie trafiłoby do `<HeadContent/>`).
    const bezposrednio = routeHead(CommunityShellRoute);
    expect(bezposrednio.meta).toContainEqual({ title: "Community · Admin" });
    expect(bezposrednio.meta).toContainEqual({
      name: "robots",
      content: "noindex, nofollow",
    });

    // ODCZYT PRZEZ ROUTER IDZIE NA POWŁOCE BEZ DZIECI - i to nie jest wygodny
    // skrót. `renderRoute(...).meta()` czyta OSTATNIE dopasowanie
    // (`matches.at(-1)`), bo tak wygląda kontrakt tego harnessu; z dziećmi
    // ostatnim dopasowaniem jest PODSTRONA, a ta w produkcji ma własny `head()`
    // i nadpisuje tytuł powłoki. Mierzenie tam meta powłoki dawałoby pustą
    // tablicę i test, który „przechodzi" na `[]` po skasowaniu `head()`.
    const { meta } = await zamontujPowloke(SCIEZKA, "bez dzieci");
    expect(meta()).toContainEqual({ title: "Community · Admin" });
    expect(meta()).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    cleanup();
  });
});

describe("/admin/community - gdzie stoi bramka uprawnień", () => {
  it("ta trasa NIE bramkuje dostępu sama - renderuje się bez pytania o rolę", async () => {
    // Dowód pozytywny: powłoka montuje się w harnessie, w którym nie ma ani
    // sesji, ani `AuthProvider`. To NIE jest dziura - to podział pracy opisany
    // w nagłówku pliku. Gdyby ktoś dołożył warunek roli TUTAJ, ten test zapali
    // się jako pierwszy i wymusi aktualizację opisu.
    await zamontujPowloke(SCIEZKA);

    expect(screen.getByTestId("podnawigacja")).toBeInTheDocument();
    expect(screen.getByText("PODSTRONA: pulpit")).toBeInTheDocument();
    cleanup();
  });

  it("plik powłoki nie zawiera warunku roli ani przekierowania", () => {
    const zrodlo = readFileSync(PLIK_POWLOKI, "utf8");
    expect(zrodlo).not.toMatch(/isStaff|isAdmin|isSuperAdmin/);
    expect(zrodlo).not.toMatch(/beforeLoad|redirect\(|<Navigate/);
    // Kanarek zasięgu: gdyby ten odczyt kiedyś trafił w pusty plik, obie
    // asercje wyżej przechodziłyby jako fałszywy dowód.
    expect(zrodlo).toMatch(/<CommunitySubNav \/>/);
    expect(zrodlo).toMatch(/<Outlet \/>/);
  });

  it("bramka renderu żyje w layoucie `/admin` i prowadzi na /login", () => {
    // Odczyt pliku, nie render: layout jest RODZICEM tej powłoki, a harness
    // montuje ją pod zastępczym korzeniem, więc renderem nie da się go tu
    // dosięgnąć. Ta sama technika, której używa bramka
    // `adminRouteAuthority.gate.test.ts` dla wszystkich tras panelu naraz.
    const layout = readFileSync(PLIK_LAYOUTU_ADMINA, "utf8");
    expect(layout).toMatch(/isStaff/);
    expect(layout).toMatch(/navigate\(\{\s*to:\s*"\/login"\s*\}\)/);
    expect(layout).toMatch(/if \(!session \|\| !isStaff\) return null;/);
  });
});
