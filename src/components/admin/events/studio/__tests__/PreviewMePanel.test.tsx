// PODGLAD STUDIA: PRYWATNA ZAKLADKA UCZESTNIKA („Moj profil").
//
// PO CO TEN PLIK ISTNIEJE. To jedyna powierzchnia podgladu, ktora pokazuje
// DANE OSOBOWE - i jedyna, ktora musi wybrac, CZYJE. Kolejnosc zrodel jest tu
// cala trescia: kartoteka wydarzenia zalogowanego redaktora > jego profil
// platformy > rysunek przykladowy. Pomylka w tej kolejnosci nie wyglada na
// blad: ekran nadal pokazuje ladna karte z imieniem i nazwiskiem.
//
// CO KONKRETNIE PSUJE SIE BEZ TYCH TESTOW.
//   1. RYSUNEK PRZYKLADOWY UDAJE PRAWDZIWA OSOBE. „Anna Kowalska" bez etykiety
//      zrodla to karta, ktora superadmin bierze za czyjas kartoteke - i zaczyna
//      szukac, skad sie wziela na jego szkicu. Dlatego kazde zrodlo ma WLASNE
//      zdanie nad karta, a przykladowe dane siedza wylacznie na `example.org`.
//   2. ZAPYTANIE O KARTOTEKE LECI NA SZKICU BEZ ADRESU. RPC bramkuje pusty slug
//      WYJATKIEM, wiec podglad, ktory zapyta, wywala sie na wlasnym ekranie -
//      w chwili, w ktorej redaktor jeszcze niczego nie zapisal.
//   3. ZAPYTANIE O KARTOTEKE LECI DLA GOSCIA. `event_my_event_profile` czyta
//      TOZSAMOSC WOLAJACEGO; bez sesji nie ma czego czytac.
//   4. ODCZYT PROFILU BIERZE `*`. Tabela `profiles` ma granty KOLUMNOWE, wiec
//      gwiazdka konczy sie odmowa calego odczytu - a podglad cicho spada na
//      rysunek przykladowy zamiast pokazac redaktorowi jego samego.
//   5. KONTAKT DOMYSLNIE PUBLICZNY. Profil platformy nie niesie zgod - te zyja
//      w kartotece wydarzenia, ktorej jeszcze nie ma. Podglad nie moze
//      sugerowac zgody, ktorej nikt nie wydal.
//
// CZEGO SWIADOMIE NIE DUBLUJE. (1) Formularza kartoteki i karty publicznej -
// maja wlasne komponenty i wlasne testy; tutaj stoja atrapami, ktore ZAPISUJA
// otrzymane wlasciwosci. (2) Parsera odpowiedzi RPC (`myEventProfileApi.test.ts`)
// - hook panelu jest tu atrapa, bo przedmiotem dowodu jest WYBOR ZRODLA
// i BRAMKA zapytania, a nie ksztalt wiersza.
//
// RODO: wszystkie adresy w tym pliku to `example.org`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { axeViolations, summarize } from "@/test/axe";
import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import type {
  MyAccountSnapshot,
  MyEventPanelState,
  MyEventProfile,
} from "@/lib/events/myEventProfileApi";

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  zalogowany: true,
  /** Odpowiedz atrapy hooka kartoteki wydarzenia. */
  panel: null as MyEventPanelState | null,
  panelLoading: false,
  /** Argumenty, z jakimi zawolano `useMyEventProfile` - tu stoi bramka. */
  wywolania: [] as { slug: string; enabled: boolean }[],
  /** Wlasciwosci przekazane formularzowi i karcie publicznej. */
  formularze: [] as { slug: string; maProfil: boolean; maKonto: boolean; loading: boolean }[],
  karty: [] as { imie: string | null; grupy: number }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (h.db === null) throw new Error("test: atrapa lancucha nie zostala ustawiona");
      return h.db.from(table);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());
vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => undefined }));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: h.zalogowany ? { access_token: "test" } : null,
    user: h.zalogowany ? { id: "11111111-1111-4111-8111-111111111111" } : null,
    roles: ["admin"],
    isAdmin: true,
    tenantId: "22222222-2222-4222-8222-222222222222",
  }),
}));

// Hook kartoteki ma wlasny parser i wlasny plik testowy. Atrapa ZAPISUJE
// argumenty, bo to w nich stoi bramka („nie pytaj bez adresu i bez sesji").
vi.mock("@/lib/events/useMyEventPanel", () => ({
  useMyEventProfile: (slug: string, enabled: boolean) => {
    h.wywolania.push({ slug, enabled });
    return { data: enabled ? (h.panel ?? undefined) : undefined, isLoading: h.panelLoading };
  },
}));

vi.mock("@/components/events/participant/molecules/MyEventProfileForm", () => ({
  MyEventProfileForm: (props: {
    slug: string;
    profile: MyEventProfile | null;
    account: MyAccountSnapshot | null;
    loading: boolean;
  }) => {
    h.formularze.push({
      slug: props.slug,
      maProfil: props.profile !== null,
      maKonto: props.account !== null,
      loading: props.loading,
    });
    return <div data-testid="formularz" />;
  },
}));

vi.mock("@/components/events/participant/molecules/MyEventPublicPreview", () => ({
  MyEventPublicPreview: (props: { profile: MyEventProfile; groups: unknown[] }) => {
    h.karty.push({ imie: props.profile.firstName, grupy: props.groups.length });
    return <div data-testid="karta-publiczna" />;
  },
}));

const { PreviewMePanel } = await import("@/components/admin/events/studio/PreviewMePanel");

const ME = "eventMe.";
const SLUG = "kongres-energetyczny";

/** Kolumny, ktore odczyt profilu MUSI wymienic z nazwy - `profiles` ma granty kolumnowe. */
const KOLUMNY_PROFILU = ["first_name", "last_name", "email", "avatar_url", "linkedin_url"];

function Provider({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function panel(slug = SLUG) {
  return render(
    <Provider>
      <PreviewMePanel slug={slug} />
    </Provider>,
  );
}

function profil(overrides: Partial<MyEventProfile> = {}): MyEventProfile {
  return {
    personId: "9a7b0000-0000-4000-8000-000000000001",
    firstName: "Maria",
    lastName: "Testowa",
    email: "maria.testowa@example.org",
    phone: null,
    emailVisible: true,
    phoneVisible: false,
    jobTitle: null,
    companyId: null,
    companyText: null,
    industry: null,
    specialization: null,
    seekingPl: null,
    seekingEn: null,
    offeringPl: null,
    offeringEn: null,
    socialProfileUrl: null,
    socialLinks: {},
    photoUrl: null,
    bioPl: null,
    bioEn: null,
    ...overrides,
  };
}

/** Wiersz `profiles` zalogowanego redaktora - w ksztalcie odczytu kolumnowego. */
function wierszProfilu(): Record<string, string | null> {
  return {
    first_name: "Jan",
    last_name: "Redaktorski",
    email: "jan.redaktorski@example.org",
    phone: null,
    job_title: "Redaktor",
    current_company_id: null,
    current_company: "New European Strategies",
    specialization: null,
    seeking_pl: null,
    seeking_en: null,
    offering_pl: null,
    offering_en: null,
    avatar_url: null,
    bio_pl: null,
    bio_en: null,
    linkedin_url: "https://www.linkedin.com/in/example",
    website_url: "",
    twitter_url: null,
    facebook_url: null,
    instagram_url: null,
  };
}

beforeEach(() => {
  h.db = supabaseFromStub();
  h.zalogowany = true;
  h.panel = null;
  h.panelLoading = false;
  h.wywolania = [];
  h.formularze = [];
  h.karty = [];
  h.db.setResponse("profiles", ok(null));
});

afterEach(cleanup);

describe("PreviewMePanel - bramka zapytania o kartoteke", () => {
  it("SZKIC Z ADRESEM i zalogowany redaktor: zapytanie o kartoteke LECI", () => {
    panel();

    expect(h.wywolania.at(-1)).toEqual({ slug: SLUG, enabled: true });
  });

  it("SZKIC BEZ ADRESU: zapytanie NIE leci - RPC bramkuje pusty slug wyjatkiem", () => {
    // Druga polowa pary. Podglad nie ma prawa wywrocic sie na wydarzeniu,
    // ktoremu redaktor nie nadal jeszcze adresu publicznego.
    panel("   ");

    expect(h.wywolania.every((wywolanie) => wywolanie.enabled === false)).toBe(true);
  });

  it("BEZ SESJI zapytanie tez nie leci - RPC czyta tozsamosc WOLAJACEGO", () => {
    h.zalogowany = false;
    panel();

    expect(h.wywolania.every((wywolanie) => wywolanie.enabled === false)).toBe(true);
  });

  it("BEZ SESJI nie leci takze odczyt profilu platformy", async () => {
    h.zalogowany = false;
    panel();

    await waitFor(() => expect(screen.getByTestId("formularz")).toBeInTheDocument());
    expect(h.db?.chainsFor("profiles")).toHaveLength(0);
  });
});

describe("PreviewMePanel - kolejnosc zrodel tozsamosci", () => {
  it("KARTOTEKA WYDARZENIA wygrywa - redaktor widzi swoje dane z tego wydarzenia", async () => {
    h.panel = { profile: profil(), account: null, registration: null };
    panel();

    expect(await screen.findByText(`${ME}previewSource.person`)).toBeInTheDocument();
    expect(h.formularze.at(-1)?.maProfil).toBe(true);
  });

  it("BEZ KARTOTEKI wchodzi PROFIL PLATFORMY redaktora, a nie rysunek przykladowy", async () => {
    // To jest defekt, ktory ten odczyt zamknal: superadmin ogladajacy szkic nie
    // ma kartoteki na wydarzeniu, wiec podglad pokazywal mu „Anne Kowalska".
    h.db?.setResponse("profiles", ok(wierszProfilu()));
    panel();

    expect(await screen.findByText(`${ME}previewSource.account`)).toBeInTheDocument();
    await waitFor(() => expect(h.formularze.at(-1)?.maKonto).toBe(true));
    expect(h.formularze.at(-1)?.maProfil).toBe(false);
  });

  it("BEZ OBU zrodel wchodzi rysunek przykladowy - NAZWANY jako przykladowy", async () => {
    // Trzecia odpowiedz musi byc odrozniallna od dwoch poprzednich, inaczej
    // dane demonstracyjne czyta sie jak czyjas kartoteke.
    panel();

    expect(await screen.findByText(`${ME}previewSource.demo`)).toBeInTheDocument();
    expect(h.formularze.at(-1)?.maProfil).toBe(false);
    expect(h.formularze.at(-1)?.maKonto).toBe(false);
  });

  it("odczyt profilu wymienia KOLUMNY Z NAZWY i pyta o WLASNY wiersz", async () => {
    // `profiles` ma granty kolumnowe - `select("*")` konczy sie odmowa calego
    // odczytu, a podglad cicho spada na rysunek przykladowy.
    h.db?.setResponse("profiles", ok(wierszProfilu()));
    panel();

    await waitFor(() => expect(h.db?.lastChain("profiles")).toBeDefined());
    const lancuch = h.db?.lastChain("profiles");
    const select = String(lancuch?.argsOf("select")?.[0] ?? "");
    expect(select).not.toBe("*");
    for (const kolumna of KOLUMNY_PROFILU) expect(select).toContain(kolumna);
    expect(lancuch?.argsOf("eq")).toEqual(["id", "11111111-1111-4111-8111-111111111111"]);
    expect(lancuch?.has("maybeSingle")).toBe(true);
  });
});

describe("PreviewMePanel - zakladki uczestnika", () => {
  it("pokazuje PIEC zakladek, a otwarty jest profil", async () => {
    panel();

    await screen.findByTestId("formularz");
    expect(screen.getAllByRole("button", { name: /^eventMe\.tabs\./ })).toHaveLength(5);
    expect(screen.getByRole("button", { name: `${ME}tabs.profile` })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText(`${ME}profileHint`)).toBeInTheDocument();
  });

  it("przelaczenie zakladki zmienia ZDANIE, a formularz profilu znika", async () => {
    panel();
    await screen.findByTestId("formularz");

    fireEvent.click(screen.getByRole("button", { name: `${ME}tabs.networking` }));

    expect(screen.getByText(`${ME}networkingHint`)).toBeInTheDocument();
    // Pozostale zakladki sa POWIERZCHNIAMI OPISOWYMI - podglad nie ciagnie
    // cudzych zaproszen ani cudzej agendy.
    expect(screen.queryByTestId("formularz")).toBeNull();
  });
});

describe("PreviewMePanel - „tak widza Cie inni”", () => {
  it("przelacznik zamienia formularz na karte publiczna i z powrotem", async () => {
    h.panel = { profile: profil(), account: null, registration: null };
    panel();
    await screen.findByTestId("formularz");

    fireEvent.click(screen.getByRole("button", { name: `${ME}publicPreview.open` }));
    expect(screen.getByTestId("karta-publiczna")).toBeInTheDocument();
    expect(screen.queryByTestId("formularz")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: `${ME}publicPreview.close` }));
    expect(screen.getByTestId("formularz")).toBeInTheDocument();
  });

  it("karta publiczna dostaje GRUPY ze zgloszenia - te same, ktore widza inni", async () => {
    h.panel = {
      profile: profil(),
      account: null,
      registration: {
        registrationId: "8b6a0000-0000-4000-8000-000000000001",
        status: "approved",
        paymentStatus: null,
        directoryOptOut: false,
        notifyEmail: true,
        notifySms: false,
        groups: [
          { id: "g-1", namePl: "Prelegenci", nameEn: "Speakers", color: null },
          { id: "g-2", namePl: "VIP", nameEn: "VIP", color: null },
        ],
      },
    };
    panel();
    await screen.findByTestId("formularz");

    fireEvent.click(screen.getByRole("button", { name: `${ME}publicPreview.open` }));
    expect(h.karty.at(-1)).toEqual({ imie: "Maria", grupy: 2 });
  });

  it("wczytywanie kartoteki jedzie DO FORMULARZA, a nie do wlasnego krecidla", async () => {
    h.panelLoading = true;
    panel();

    await screen.findByTestId("formularz");
    expect(h.formularze.at(-1)?.loading).toBe(true);
  });
});

describe("PreviewMePanel - dostepnosc", () => {
  it("zakladka uczestnika nie ma naruszen axe - i w formularzu, i w karcie publicznej", async () => {
    h.panel = { profile: profil(), account: null, registration: null };
    const { container } = panel();
    await screen.findByTestId("formularz");
    // Odczyt profilu platformy domyka sie asynchronicznie - axe ma ogladac
    // ekran po ustaniu przerysowan, a nie w polowie wczytywania.
    await waitFor(() => expect(h.db?.lastChain("profiles")).toBeDefined());
    const formularz = await axeViolations(container);
    expect(formularz, summarize(formularz)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: `${ME}publicPreview.open` }));
    const karta = await axeViolations(container);
    expect(karta, summarize(karta)).toEqual([]);
  });
});
