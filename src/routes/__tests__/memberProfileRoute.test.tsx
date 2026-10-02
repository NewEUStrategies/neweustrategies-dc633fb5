// Trasa `/people/$slug` (profil członka) ZAMONTOWANA. Do dziś 0 z 21 linii -
// razem z layoutem `/people` jedyne dwa pliki funkcjonalności „Katalog osób
// i profil organizacji" na zerze (audyt pokrycia, wydanie 12).
//
// CO TEN PLIK DOWODZI:
//  1. PROFIL JEST WEWNĘTRZNY. Anonim dostaje bramkę i trasa NIE pyta bazy;
//     karta jest `noindex, nofollow` w obu językach.
//  2. `head()` MÓWI JĘZYKIEM ADRESU, a jego teksty są te same co przed
//     wyniesieniem ich ze słownika do `MEMBER_PROFILE_HEAD` (neutralność dla
//     wyszukiwarki i podglądu linku).
//  3. ŁADOWANIE, AWARIA, BRAK I PROFIL to cztery osobne ekrany; awaria daje
//     ponowienie TEGO SAMEGO odczytu, brak - drogę z powrotem do katalogu.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE: widoku profilu (`MemberProfileView` ma własny
// plik - tu jest markerem), walidacji wiersza RPC (`memberProfile.test.ts`)
// ani reguł `get_member_profile` (SECURITY DEFINER, pgTAP).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

interface RpcResult {
  data: unknown;
  error: { message: string } | null;
}

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  requestUrl: "",
  session: { id: "u1" } as { id: string } | null,
  authLoading: false,
  rpcCalls: [] as { name: string; args: unknown }[],
  /** Odpowiedź RPC; funkcja pozwala zwrócić obietnicę, która nie rozstrzyga się wcale. */
  respond: (() => Promise.resolve({ data: null, error: null })) as () => Promise<RpcResult>,
  viewProps: [] as { slug: string; lang: string }[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: unknown) => {
      h.rpcCalls.push({ name, args });
      return h.respond();
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.session, session: h.session, loading: h.authLoading }),
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/i18n/localeRuntime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/localeRuntime")>()),
  currentLang: () => h.lang,
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/components/people/organisms/MemberProfileView", () => ({
  MemberProfileView: (props: { profile: { slug: string }; lang: string }) => {
    h.viewProps.push({ slug: props.profile.slug, lang: props.lang });
    return <article data-testid="profil" data-slug={props.profile.slug} data-lang={props.lang} />;
  },
}));

// `react-i18next` NIE JEST atrapowany: fabryka z prawdziwym `t` sięga po
// `@/lib/i18n`, który importuje właśnie atrapowany pakiet (zakleszczenie -
// ostrzeżenie z nagłówka `@/test/i18nReal`). Język przełączamy na PRAWDZIWEJ
// instancji, więc asercje czytają napis ze słownika, a klucz bez rejestracji
// nakładki oblałby test zamiast przejść na samym kluczu.
const i18n = (await import("@/lib/i18n")).default;
await import("@/test/i18nReal");
const { renderRoute } = await import("@/test/routeHarness");
const { Route: MemberRoute } = await import("@/routes/people.$slug");
const { Route: PeopleLayoutRoute } = await import("@/routes/people");
const { SITE_NAME } = await import("@/lib/seo/meta");
const { memberProfilePl, memberProfileEn } = await import("@/lib/i18n-member-profile");

const PL = memberProfilePl.memberProfile;
const EN = memberProfileEn.memberProfile;

const ROW = {
  id: "p-1",
  slug: "anna-nowak",
  display_name: "Anna Nowak",
  avatar_url: null,
  cover_url: null,
  job_title: "Analityczka",
  company: "Instytut",
  location: null,
  bio_pl: null,
  bio_en: null,
  specialization: null,
  linkedin_url: null,
  website_url: null,
  verified: false,
  is_self: false,
  is_author: false,
};

async function mount(entry = "/people/anna-nowak") {
  let view!: Awaited<ReturnType<typeof renderRoute>>;
  await act(async () => {
    view = await renderRoute({ route: MemberRoute, path: "/people/$slug", initialEntry: entry });
  });
  return view;
}

function meta(view: Awaited<ReturnType<typeof mount>>, key: string, value: string): string {
  const found = view.meta().find((m) => m[key] === value);
  if (typeof found?.content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return found.content;
}

function title(view: Awaited<ReturnType<typeof mount>>): string {
  const found = view.meta().find((m) => typeof m.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/** Język interfejsu (`useTranslation`) i języka renderu (`currentLang`) naraz. */
async function setLang(lang: "pl" | "en") {
  h.lang = lang;
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
}

beforeEach(async () => {
  await setLang("pl");
  h.requestUrl = "";
  h.session = { id: "u1" };
  h.authLoading = false;
  h.rpcCalls = [];
  h.respond = () => Promise.resolve({ data: ROW, error: null });
  h.viewProps = [];
});

afterEach(() => {
  cleanup();
});

describe("/people/$slug - nagłówek", () => {
  it("karta po polsku: tytuł, opis i NOINDEX - profil nie jest treścią publiczną", async () => {
    const view = await mount();
    expect(title(view)).toBe(`Profil członka - ${SITE_NAME}`);
    expect(meta(view, "name", "description")).toBe(
      "Profil członka społeczności New European Strategies.",
    );
    expect(meta(view, "name", "robots")).toBe("noindex, nofollow");
    expect(meta(view, "property", "og:type")).toBe("profile");
    expect(meta(view, "property", "og:title")).toBe(title(view));
  });

  it("język karty idzie z ADRESU, nie z interfejsu - podgląd linku EN jest po angielsku", async () => {
    h.requestUrl = "https://nes.example.org/en/people/anna-nowak";
    const view = await mount();
    expect(title(view)).toBe(`Member profile - ${SITE_NAME}`);
    expect(meta(view, "property", "og:description")).toBe(
      "A New European Strategies community member profile.",
    );
    expect(meta(view, "name", "robots")).toBe("noindex, nofollow");
  });
});

describe("/people/$slug - bramka", () => {
  it("anonim dostaje bramkę i trasa NIE pyta bazy", async () => {
    h.session = null;
    await mount();
    expect(screen.getByText(PL.gateBody)).toBeTruthy();
    expect(h.rpcCalls).toEqual([]);
    expect(screen.queryByTestId("profil")).toBeNull();
  });

  it("dopóki sesja się rozstrzyga, widać wskaźnik pracy, a nie bramkę", async () => {
    h.session = null;
    h.authLoading = true;
    const view = await mount();
    expect(view.container.querySelector('[aria-label="loading"]')).not.toBeNull();
    expect(screen.queryByText(PL.gateBody)).toBeNull();
  });
});

describe("/people/$slug - stany profilu", () => {
  it("pyta RPC o slug z adresu i oddaje profil widokowi w języku strony", async () => {
    await mount();
    expect(await screen.findByTestId("profil")).toBeTruthy();
    expect(h.rpcCalls).toEqual([{ name: "get_member_profile", args: { p_slug: "anna-nowak" } }]);
    expect(h.viewProps.at(-1)).toEqual({ slug: "anna-nowak", lang: "pl" });
  });

  it("wersja EN dostaje `lang=en`, a każdy inny język schodzi do polskiego", async () => {
    await setLang("en");
    await mount();
    expect((await screen.findByTestId("profil")).getAttribute("data-lang")).toBe("en");
  });

  it("ŁADOWANIE ma własny komunikat - nie pustą stronę i nie „nie znaleziono”", async () => {
    h.respond = () => new Promise<RpcResult>(() => {});
    await mount();
    expect(screen.getByText(PL.loading)).toBeTruthy();
    expect(screen.queryByText(PL.notFoundTitle)).toBeNull();
  });

  it("AWARIA mówi o sobie i ponawia TEN SAM odczyt", async () => {
    h.respond = () => Promise.resolve({ data: null, error: { message: "test: rpc niedostepne" } });
    await mount();
    const retry = await screen.findByRole("button", { name: PL.retry });
    expect(screen.getByText(PL.error)).toBeTruthy();

    h.respond = () => Promise.resolve({ data: ROW, error: null });
    await act(async () => {
      fireEvent.click(retry);
    });
    expect(await screen.findByTestId("profil")).toBeTruthy();
    expect(h.rpcCalls.map((c) => c.args)).toEqual([
      { p_slug: "anna-nowak" },
      { p_slug: "anna-nowak" },
    ]);
  });

  it("BRAK profilu (ukryty, obcy najemca, zły slug) prowadzi z powrotem do katalogu", async () => {
    h.respond = () => Promise.resolve({ data: null, error: null });
    await mount();
    expect(await screen.findByRole("heading", { name: PL.notFoundTitle })).toBeTruthy();
    expect(screen.getByText(PL.notFoundBody)).toBeTruthy();
    expect(screen.getByRole("link", { name: PL.backToPeople }).getAttribute("href")).toBe(
      "/people",
    );
  });

  it("ekrany stanów mówią po angielsku w wersji EN", async () => {
    await setLang("en");
    h.respond = () => Promise.resolve({ data: null, error: null });
    await mount();
    expect(await screen.findByRole("heading", { name: EN.notFoundTitle })).toBeTruthy();
    expect(screen.getByRole("link", { name: EN.backToPeople })).toBeTruthy();
  });
});

describe("/people - layout sekcji", () => {
  it("jest samym <Outlet/> - katalog i profil członka renderują się pod nim", async () => {
    // `people.tsx` nie ma `head()` ani loadera: gdyby je dostał, nadpisywałby
    // nagłówek KAŻDEGO dziecka (katalogu i profilu) jednym, wspólnym tytułem.
    expect(PeopleLayoutRoute.options.head).toBeUndefined();
    expect(PeopleLayoutRoute.options.loader).toBeUndefined();
    let view!: Awaited<ReturnType<typeof renderRoute>>;
    await act(async () => {
      view = await renderRoute({
        route: PeopleLayoutRoute,
        path: "/people",
        initialEntry: "/people",
      });
    });
    // Bez dopasowanego dziecka layout nie dokłada ŻADNEJ własnej treści.
    expect(view.container.textContent).toBe("");
    expect(view.meta()).toEqual([]);
  });
});
