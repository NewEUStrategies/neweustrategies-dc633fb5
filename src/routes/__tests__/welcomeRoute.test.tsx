// Trasa `/welcome` - powitanie po aktywacji konta z e-maila zaproszenia oraz
// po zmianie planu (`?mode=upgrade`).
//
// PO CO OSOBNY PLIK. `src/routes/welcome.tsx` nie miał do tej pory ANI JEDNEGO
// testu (zmierzone na HEAD: 0/12 linii, 0/4 funkcji, 0/16 gałęzi), a jest to
// jedyny ekran, na który świeżo aktywowany członek trafia PROSTO Z E-MAILA -
// bez nawigacji, którą dałoby się cofnąć, i bez drugiej drogi dojścia. Całe
// ryzyko siedzi w warstwie SKLEJENIA trasy, więc test montuje prawdziwą trasę
// w routerze pamięciowym (`@/test/routeHarness`), a nie sam komponent:
//
//   1. `validateSearch` - `mode` przychodzi z adresu w e-mailu i steruje
//      TREŚCIĄ powitania. Wszystko poza kanonicznym `upgrade` ma zniknąć, żeby
//      w stanie trasy nie wylądował cudzy ładunek z linku;
//   2. STRAŻNIK SESJI - bez użytkownika trasa odsyła do logowania, ale NIE
//      WOLNO jej tego robić, dopóki sesja się ładuje: wejście z e-maila jest
//      zawsze zimne, więc przez pierwsze milisekundy `user` jest `null`
//      u KAŻDEGO, także u zalogowanego;
//   3. `head()` - strona członkowska nie może wejść do indeksu wyszukiwarki,
//      a tytuł i opis muszą iść za językiem ADRESU (link w e-mailu EN nie może
//      otworzyć polskiego nagłówka);
//   4. panel benefitów renderuje się WYŁĄCZNIE dla zalogowanego - inaczej
//      anonim widzi listę korzyści planu, którego nie ma.
//
// Zero sieci: warstwa sesji i panel benefitów (własna suita) to atrapy,
// wszystkie adresy w `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Stan sesji wstrzykiwany do `useAuth` - patrz atrapa niżej. */
  auth: { user: null as { id: string } | null, loading: false },
  /** Przejścia zlecone przez `useNavigate()` w kolejności wywołań. */
  navigations: [] as Record<string, unknown>[],
  /** Adres żądania widziany przez `getRequestUrl()` w `head()`. */
  requestUrl: "",
}));

// SESJA JAKO WSTRZYKIWANE WEJŚCIE. Prawdziwy `AuthProvider` ciągnie klienta
// Supabase, ustawienia logowania i scalanie personalizacji anonimowej - a
// przedmiotem dowodu jest tu wyłącznie to, co trasa robi z parą
// (`loading`, `user`).
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => h.auth }));

// `useNavigate` jest atrapą, bo celem przejścia jest `/login` - trasa spoza
// drzewa harnessu (harness montuje JEDNĄ trasę). Atrapa jest CZĄSTKOWA:
// `createFileRoute`, `RouterProvider` i cała reszta routera zostają prawdziwe,
// bo to na nich stoi montaż trasy i walidacja search params.
vi.mock("@tanstack/react-router", async (o) => {
  const actual = await o<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => (options: Record<string, unknown>) => {
      h.navigations.push(options);
      return Promise.resolve();
    },
  };
});

// Panel benefitów ma własną suitę (`components/membership`). Tutaj dowodem jest
// TO, CZY I Z JAKIM TRYBEM trasa go montuje, a nie jego zawartość - prawdziwy
// komponent dociągnąłby warstwy członkostwa, ustawienia motywu i logo.
vi.mock("@/components/membership/MembershipWelcome", () => ({
  MembershipWelcome: ({ mode }: { mode: string }) => (
    <div data-testid="membership-welcome" data-mode={mode} />
  ),
}));

vi.mock("@/lib/seo/request", async (o) => ({
  ...(await o<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

import { renderRoute, routeHead, routeSearchValidator } from "@/test/routeHarness";
import { SITE_NAME } from "@/lib/seo/meta";
import { Route as WelcomeRoute } from "@/routes/welcome";

const PATH = "/welcome";

async function mount(entry = PATH) {
  return renderRoute({ route: WelcomeRoute, path: PATH, initialEntry: entry });
}

beforeEach(() => {
  h.auth = { user: null, loading: false };
  h.navigations = [];
  h.requestUrl = "";
});

afterEach(() => {
  cleanup();
});

describe("trasa /welcome - walidacja `mode` z adresu w e-mailu", () => {
  it("przepuszcza wyłącznie kanoniczne `upgrade`, resztę zeruje", () => {
    const validate = routeSearchValidator(WelcomeRoute);

    // Pętla po KOMPLECIE kształtów, jakie potrafi przynieść link z e-maila:
    // literówka, powtórzony klucz (tablica), wartość strukturalna i brak klucza.
    // Każdy z nich musi dać `undefined`, bo `mode` steruje treścią powitania.
    for (const raw of [
      { mode: "upgraded" },
      { mode: ["upgrade", "upgrade"] },
      { mode: { value: "upgrade" } },
      { mode: 1 },
      {},
    ]) {
      expect(routeSearchValidator(WelcomeRoute)(raw)).toEqual({ mode: undefined });
    }
    expect(validate({ mode: "upgrade" })).toEqual({ mode: "upgrade" });
  });

  it("montuje się pod własną ścieżką i niesie `mode` do stanu trasy", async () => {
    h.auth = { user: { id: "user-1" }, loading: false };
    const view = await mount(`${PATH}?mode=upgrade`);

    expect(view.currentPath()).toBe(PATH);
    expect(view.search()).toMatchObject({ mode: "upgrade" });
  });
});

describe("trasa /welcome - strażnik sesji", () => {
  it("bez sesji odsyła do logowania PODMIENIAJĄC wpis historii", async () => {
    await mount();

    // `replace: true` jest częścią dowodu, nie ozdobą: bez niego „wstecz"
    // z ekranu logowania wraca na `/welcome`, ten znów odsyła do `/login`
    // i czytelnik zostaje uwięziony w pętli przycisku wstecz.
    await waitFor(() => expect(h.navigations).toHaveLength(1));
    expect(h.navigations[0]).toEqual({ to: "/login", replace: true });
  });

  it("NIE odsyła, dopóki sesja się ładuje", async () => {
    // Wejście z linku w e-mailu jest zawsze zimne: przez pierwsze milisekundy
    // `user` jest `null` U KAŻDEGO, także u zalogowanego. Gdyby strażnik czytał
    // sam `user`, aktywowany właśnie członek dostawałby mignięcie `/login`
    // zamiast powitania - i to na jedynym ekranie, na który prowadzi ten link.
    h.auth = { user: null, loading: true };
    await mount();

    expect(h.navigations).toEqual([]);
    expect(screen.queryByTestId("membership-welcome")).not.toBeInTheDocument();
  });

  it("z sesją nie rusza nigdzie i pokazuje panel benefitów", async () => {
    h.auth = { user: { id: "user-1" }, loading: false };
    await mount();

    expect(h.navigations).toEqual([]);
    expect(screen.getByTestId("membership-welcome")).toBeInTheDocument();
  });

  it("bez sesji nie renderuje panelu benefitów ani przez chwilę", async () => {
    // Przekierowanie jedzie efektem PO renderze, więc sam render musi być
    // pusty. Inaczej anonim (albo robot, który nie wykona efektu) zobaczyłby
    // listę korzyści planu, którego nie ma.
    const view = await mount();

    expect(screen.queryByTestId("membership-welcome")).not.toBeInTheDocument();
    expect(view.container.querySelector(".container")?.textContent).toBe("");
  });
});

describe("trasa /welcome - tryb powitania z adresu", () => {
  it("`?mode=upgrade` daje wariant po zmianie planu, brak parametru - po aktywacji", async () => {
    h.auth = { user: { id: "user-1" }, loading: false };
    await mount(`${PATH}?mode=upgrade`);
    expect(screen.getByTestId("membership-welcome")).toHaveAttribute("data-mode", "upgraded");
    cleanup();

    await mount(PATH);
    expect(screen.getByTestId("membership-welcome")).toHaveAttribute("data-mode", "activated");
  });

  it("`mode` spoza kontraktu spada do wariantu po aktywacji", async () => {
    // Walidator zeruje wszystko poza `upgrade`, więc link z literówką nie może
    // podmienić treści powitania na „plan aktywny" komuś, kto właśnie założył
    // konto - i nie może też wywrócić renderu.
    h.auth = { user: { id: "user-1" }, loading: false };
    await mount(`${PATH}?mode=downgrade`);

    expect(screen.getByTestId("membership-welcome")).toHaveAttribute("data-mode", "activated");
    expect(h.navigations).toEqual([]);
  });
});

describe("trasa /welcome - nagłówek dokumentu", () => {
  it("trzyma stronę członkowską poza indeksem wyszukiwarek", () => {
    const meta = routeHead(WelcomeRoute).meta ?? [];

    expect(meta).toContainEqual({ name: "robots", content: "noindex, nofollow" });
    // Kontrola: nagłówek NIE jest pusty - inaczej asercja wyżej „przechodziłaby"
    // na braku jakiegokolwiek wyjścia z `head()`.
    expect(meta.length).toBeGreaterThan(1);
  });

  it("bez adresu żądania buduje nagłówek na własnej ścieżce (PL)", () => {
    // `getRequestUrl()` oddaje pusty string wszędzie poza żądaniem SSR
    // (np. w nawigacji po hydratacji). Bez zapasowego `"/welcome"` kanoniczny
    // adres i język liczyłyby się z pustego stringa.
    const meta = routeHead(WelcomeRoute).meta ?? [];

    expect(meta).toContainEqual({ property: "og:title", content: `Witamy - ${SITE_NAME}` });
    expect(meta).toContainEqual({ httpEquiv: "content-language", content: "pl" });
  });

  it("adres z prefiksem `/en` przełącza tytuł i opis na angielskie", () => {
    // Link aktywacyjny w e-mailu EN prowadzi na `/en/welcome`. Gdyby `head()`
    // czytał język z ustawień przeglądarki zamiast z adresu, anglojęzyczny
    // członek dostałby polski tytuł i polski opis w podglądzie linku.
    h.requestUrl = "https://example.org/en/welcome";
    const meta = routeHead(WelcomeRoute).meta ?? [];

    expect(meta).toContainEqual({ property: "og:title", content: `Welcome - ${SITE_NAME}` });
    expect(meta).toContainEqual({ httpEquiv: "content-language", content: "en" });
    expect(meta).toContainEqual({
      name: "description",
      content: "Your New European Strategies membership is active. See the benefits of your plan.",
    });
  });

  it("polski opis mówi o aktywnym członkostwie po polsku", () => {
    const meta = routeHead(WelcomeRoute).meta ?? [];

    expect(meta).toContainEqual({
      name: "description",
      content:
        "Twoje członkostwo New European Strategies jest aktywne. Zobacz benefity swojego planu.",
    });
    expect(meta).toContainEqual({ property: "og:type", content: "website" });
  });
});
