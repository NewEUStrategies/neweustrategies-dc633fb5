// `/club/join/$token` - realizacja linku zapraszającego do klubu.
//
// CO TEN PLIK DOWODZI. Cała logika (ważność linku, limit użyć, blokady, wpis
// członkostwa) siedzi w JEDNEJ transakcji po stronie bazy - trasa tylko woła
// RPC i TŁUMACZY wynik. Dlatego przedmiotem dowodu jest wyłącznie to
// tłumaczenie, i ma ono cztery miejsca, w których realnie się psuje:
//
//   1. LINK WOLNO ZREALIZOWAĆ DOKŁADNIE RAZ na wejście. Bez blokady (`ref`)
//      ponowny render w trybie ścisłym Reacta wysyła drugie żądanie - a to
//      przy linku z limitem jednego użycia ZUŻYWA zaproszenie i drugie
//      wywołanie kończy się „link wyczerpany”. Regresja jest niewidoczna
//      w środowisku bez trybu ścisłego, więc test pilnuje LICZBY wywołań.
//   2. KAŻDY kod odmowy z bazy dostaje własny klucz i18n, a kod nieznany
//      degraduje się do ogólnego - nigdy do pustego komunikatu i nigdy do
//      surowego tekstu z Postgresa.
//   3. STATUS `pending` to NIE sukces wejścia: klub z zatwierdzaniem zgłasza
//      prośbę, więc nawigacja do klubu byłaby kłamstwem (użytkownik trafiłby
//      na bramkę „nie jesteś członkiem”). Trasa zostaje na miejscu i mówi,
//      że prośba czeka.
//   4. GOŚĆ nie realizuje linku, tylko dostaje zaproszenie do logowania -
//      inaczej mutacja idzie do RPC bez sesji i wraca `auth_required`.
//
// Osobno: droga powrotna jest `Link`, a nie surowym `<a href>`. Tylko router
// przepuszcza adres przez `rewrite.output`, który dokleja prefiks języka -
// surowy odnośnik wyrzucał czytelnika z `/en/` na polską wersję i przeładowywał
// całą aplikację. To jedna asercja, ale ratuje realny błąd, który już był.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - REGUŁ LINKU: ważność, limit i blokady są w RPC i mają pgTAP
//   (`discussion_clubs_a*`). Test nie odtwarza ich na atrapie.
// - MAPOWANIA KOMUNIKATÓW: `toClubInviteError` jest funkcją czystą z własnym
//   zakresem w `src/lib/clubs/__tests__/inviteErrors.test.ts`. Tutaj używamy
//   PRAWDZIWEJ funkcji na prawdziwych fragmentach komunikatów z migracji -
//   dzięki temu test pilnuje SKLEJENIA (kod -> klucz), a nie kopii tabeli.
//
// JEDNA GAŁĄŹ NIEDOBITA - ARYTMETYCZNIE NIEOSIĄGALNA. W linii 96 stoi
// `errorKey ? t(errorKey) : t("adminClubs.saveFailed")`, ale gałąź `else` nie ma
// wejścia: karta wyniku renderuje się dopiero, gdy pierwszy warunek
// (`loading || (session && !errorKey && !pendingApproval)`) jest FAŁSZYWY,
// a przy zalogowanym to znaczy `errorKey !== null` ALBO `pendingApproval`.
// W tym drugim wypadku rysuje się gałąź „prośba czeka”, nie ta. Zapasowy
// komunikat jest więc martwy - i to jest obserwacja o KODZIE, nie luka
// w teście; usunięcie go należy do właściciela trasy, nie do zadania testowego.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

interface RedeemResult {
  clubSlug: string;
  status: string;
}

const h = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  loading: false,
  /** Wynik RPC albo błąd - dokładnie jedno z dwóch. */
  result: { clubSlug: "klub-energetyczny", status: "active" } as RedeemResult | null,
  error: null as unknown,
  /** Tokeny, z jakimi trasa zawołała mutację - liczba wywołań jest tu dowodem. */
  redeemed: [] as string[],
  navigations: [] as { to: string; params?: Record<string, unknown> }[],
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-club", () => ({ ensureClubI18n: () => undefined }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.session, user: h.session?.user ?? null, loading: h.loading }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    useNavigate: () => (options: { to: string; params?: Record<string, unknown> }) => {
      h.navigations.push(options);
      return Promise.resolve();
    },
  };
});
vi.mock("@/lib/clubs/useClubs", () => ({
  useRedeemClubInviteLink: () => ({
    mutate: (
      token: string,
      handlers: { onSuccess: (r: RedeemResult) => void; onError: (e: unknown) => void },
    ) => {
      h.redeemed.push(token);
      if (h.error !== null) handlers.onError(h.error);
      else if (h.result !== null) handlers.onSuccess(h.result);
    },
    isPending: false,
  }),
}));

import { renderRoute, routeMeta } from "@/test/routeHarness";
import { Route as JoinRoute } from "@/routes/club.join.$token";
import { CLUB_IDS } from "@/test/clubs/fixtures";

const TOKEN = "zaproszenie-abc123";
const PATH = "/club/join/$token";

async function mount(token: string = TOKEN) {
  return renderRoute({ route: JoinRoute, path: PATH, initialEntry: `/club/join/${token}` });
}

beforeEach(() => {
  cleanup();
  h.session = { user: { id: CLUB_IDS.me } };
  h.loading = false;
  h.result = { clubSlug: "klub-energetyczny", status: "active" };
  h.error = null;
  h.redeemed = [];
  h.navigations = [];
});

// --- nagłówek --------------------------------------------------------------

describe("nagłówek - link zapraszający nie należy do indeksu", () => {
  it("emituje `noindex,nofollow` BEZWARUNKOWO", async () => {
    // Adres zawiera token: jego wyciek do indeksu wyszukiwarki to zaproszenie
    // do klubu wydane komukolwiek, kto wpisze zapytanie.
    const meta = await routeMeta(JoinRoute);
    expect(meta).toEqual([{ name: "robots", content: "noindex,nofollow" }]);
  });

  it("nie ma loadera - nie ma czego dogrzewać przed realizacją linku", () => {
    expect(JoinRoute.options.loader).toBeUndefined();
  });
});

// --- gość ------------------------------------------------------------------

describe("gość - link wymaga konta", () => {
  it("nie realizuje linku i prosi o logowanie", async () => {
    h.session = null;
    await mount();
    expect(h.redeemed).toEqual([]);
    expect(screen.getByText("club.membersOnlyTitle")).toBeTruthy();
    expect(screen.getByText("club.linkNeedsSignIn")).toBeTruthy();
    expect(screen.getByRole("link", { name: "club.signIn" }).getAttribute("href")).toBe("/login");
  });

  it("trwający odczyt sesji pokazuje pracę w toku, nie ekran logowania", async () => {
    // Bez tego stanu każdy z sesją w cookies widziałby na moment „zaloguj się”
    // i zdążył kliknąć - a po powrocie z logowania token byłby już zużyty.
    h.loading = true;
    h.session = null;
    await mount();
    expect(screen.getByText("club.joiningByLink")).toBeTruthy();
    expect(screen.queryByText("club.linkNeedsSignIn")).toBeNull();
    expect(h.redeemed).toEqual([]);
  });
});

// --- realizacja ------------------------------------------------------------

describe("realizacja linku - DOKŁADNIE raz na wejście", () => {
  it("woła RPC z tokenem Z ADRESU", async () => {
    await mount("token-z-maila");
    await waitFor(() => {
      expect(h.redeemed).toEqual(["token-z-maila"]);
    });
  });

  it("nie realizuje linku DWA razy, choćby komponent przerenderował się", async () => {
    // `attempted` to ref, nie stan: ponowny render nie może wysłać drugiego
    // żądania, bo link z limitem jednego użycia zostałby zużyty na próżno.
    const rendered = await mount();
    await waitFor(() => {
      expect(h.redeemed).toHaveLength(1);
    });
    await rendered.navigate(`/club/join/${TOKEN}`);
    expect(h.redeemed).toHaveLength(1);
  });

  it("sukces przenosi do klubu wskazanego PRZEZ BAZĘ, nie do katalogu", async () => {
    h.result = { clubSlug: "klub-transportowy", status: "active" };
    await mount();
    await waitFor(() => {
      expect(h.navigations).toEqual([
        { to: "/club/$clubSlug", params: { clubSlug: "klub-transportowy" } },
      ]);
    });
  });

  it("status `pending` NIE przenosi do klubu - to prośba, nie wejście", async () => {
    // Klub z zatwierdzaniem: nawigacja byłaby kłamstwem, bo użytkownik trafiłby
    // na bramkę „nie jesteś członkiem” tuż po komunikacie o sukcesie.
    h.result = { clubSlug: "klub-energetyczny", status: "pending" };
    await mount();
    await waitFor(() => {
      expect(screen.getByText("club.joinRequested")).toBeTruthy();
    });
    expect(h.navigations).toEqual([]);
  });

  it("dopóki RPC nie odpowiedziało, strona mówi o pracy w toku", async () => {
    h.result = null;
    h.error = null;
    await mount();
    expect(screen.getByText("club.joiningByLink")).toBeTruthy();
  });
});

// --- odmowy ----------------------------------------------------------------

describe("odmowy - każdy kod z bazy dostaje własny klucz i18n", () => {
  /** Fragmenty komunikatów DOKŁADNIE takie, jak rzuca je migracja. */
  const ODMOWY: readonly { readonly komunikat: string; readonly kod: string }[] = [
    { komunikat: "clubs: link expired", kod: "link_expired" },
    { komunikat: "clubs: link revoked", kod: "link_revoked" },
    { komunikat: "clubs: link exhausted", kod: "link_exhausted" },
    { komunikat: "clubs: already a member", kod: "already_member" },
    { komunikat: "clubs: banned", kod: "banned" },
    { komunikat: "clubs: tier too low", kod: "tier_too_low" },
    { komunikat: "clubs: invitation required", kod: "invitation_required" },
    { komunikat: "clubs: recently declined", kod: "recently_declined" },
  ];

  it.each(ODMOWY)("„$komunikat” pokazuje klucz odmowy $kod", async ({ komunikat, kod }) => {
    h.error = new Error(komunikat);
    h.result = null;
    await mount();
    await waitFor(() => {
      expect(screen.getByText(`adminClubs.invitations.error.${kod}`)).toBeTruthy();
    });
    expect(h.navigations).toEqual([]);
  });

  it("kod NIEZNANY degraduje do ogólnego komunikatu, nie do pustki", async () => {
    h.error = new Error("connection reset by peer");
    h.result = null;
    await mount();
    await waitFor(() => {
      expect(screen.getByText("adminClubs.saveFailed")).toBeTruthy();
    });
  });

  it("odmowa NIE pokazuje surowego tekstu z Postgresa", async () => {
    h.error = new Error("ERROR:  clubs: link expired (SQLSTATE P0001) at RAISE");
    h.result = null;
    const { container } = await mount();
    await waitFor(() => {
      expect(screen.getByText("adminClubs.invitations.error.link_expired")).toBeTruthy();
    });
    expect(container.textContent).not.toContain("SQLSTATE");
    expect(container.textContent).not.toContain("RAISE");
  });

  it("odrzucenie BEZ obiektu Error też kończy się ogólnym komunikatem", async () => {
    h.error = "padło";
    h.result = null;
    await mount();
    await waitFor(() => {
      expect(screen.getByText("adminClubs.saveFailed")).toBeTruthy();
    });
  });

  it("po odmowie droga powrotna idzie PRZEZ ROUTER, nie surowym odnośnikiem", async () => {
    // Surowe `<a href="/club">` wyrzucało czytelnika z `/en/` na wersję polską
    // i przeładowywało całą aplikację - tylko `Link` przechodzi przez
    // `rewrite.output`, który dokleja prefiks języka.
    h.error = new Error("clubs: link revoked");
    h.result = null;
    await mount();
    const back = await waitFor(() => screen.getByRole("link", { name: "club.title" }));
    expect(back.getAttribute("href")).toBe("/club");
    // `Link` routera renderuje `data-status`; surowy `<a>` nie ma go nigdy.
    expect(back.hasAttribute("data-status")).toBe(true);
  });

  it("po zgłoszeniu prośby droga powrotna też jest dostępna", async () => {
    h.result = { clubSlug: "klub-energetyczny", status: "pending" };
    await mount();
    const back = await waitFor(() => screen.getByRole("link", { name: "club.title" }));
    expect(back.getAttribute("href")).toBe("/club");
  });
});
