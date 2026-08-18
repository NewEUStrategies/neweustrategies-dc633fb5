// Panel „Social i bio” (/profile/edit) - stał na ZERZE pokrycia przy 115
// instrukcjach. Prawie cała ta logika obraca się wokół JEDNEGO pola: `slug`,
// czyli publicznego adresu profilu (`/author/<slug>`).
//
// Dlaczego to jest najdroższe pole w profilu: adres raz opublikowany żyje
// w cudzych linkach, w wizytówkach i w indeksie wyszukiwarki. Formularz musi
// więc rozstrzygnąć PRZED zapisem, czy adres jest w ogóle możliwy - i zrobić to
// pięcioma różnymi odpowiedziami (za krótki, niepoprawny, zarezerwowany, zajęty,
// wolny), bo „nie da się” bez powodu nie mówi użytkownikowi, co poprawić.
//
// Dwie pułapki, które ten plik pilnuje szczególnie:
//
//   1. KOMUNIKAT MUSI PASOWAĆ DO STANU. Blokada zapisu wybiera klucz i18n
//      czterostopniowym łańcuchem `?:`. Przestawienie gałęzi daje komunikat
//      „adres zajęty” dla adresu ZAREZERWOWANEGO - a użytkownik będzie w
//      nieskończoność próbował innych wariantów tego samego słowa.
//   2. PODGLĄD ADRESU MUSI POKAZYWAĆ DOMENĘ TENANTA. Origin bierze się z
//      `tenants.domain`, nie z adresu okna. Fallback na okno jest awaryjny -
//      gdyby wygrywał zawsze, użytkownik dostałby do rozesłania adres, który
//      poza jego tenantem nie istnieje.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
// `BrandIcon` (ikony serwisów przy polach linków) czyta katalog ikon przez
// `useQuery`, więc panel nie wstanie bez QueryClienta - stąd wspólny helper.
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { PROFILE_IDS } from "@/test/profile/fixtures";

const h = vi.hoisted(() => ({
  user: { current: null as { id: string; email?: string } | null },
  rpc: vi.fn(),
  /** Wiersz `profiles` zwracany dla zapytania o `tenant_id`. */
  tenantRow: { current: null as { tenant_id: string | null } | null },
  /** Wiersz `tenants` z kanoniczną domeną. */
  domainRow: { current: null as { domain: string | null } | null },
  /** Czy istnieje INNY profil o sprawdzanym slugu. */
  slugTaken: { current: false },
  slugChecks: [] as Array<Array<[string, unknown]>>,
  updates: [] as Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  updateError: { current: null as { message: string } | null },
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/profile/fixtures");
  return fixtures.reactI18nextStub();
});

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: h.user.current }) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => h.rpc(fn),
    from: (table: string) => ({
      select: (columns: string) => {
        const filters: Array<[string, unknown]> = [];
        const builder = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return builder;
          },
          neq: (column: string, value: unknown) => {
            filters.push([`neq:${column}`, value]);
            return builder;
          },
          maybeSingle: () => {
            if (table === "tenants") {
              return Promise.resolve({ data: h.domainRow.current, error: null });
            }
            // `profiles` obsługuje DWA różne zapytania: o tenanta (select
            // "tenant_id") i o zajętość sluga (select "id" + neq).
            if (columns === "tenant_id") {
              return Promise.resolve({ data: h.tenantRow.current, error: null });
            }
            h.slugChecks.push(filters);
            return Promise.resolve({
              data: h.slugTaken.current ? { id: PROFILE_IDS.other } : null,
              error: null,
            });
          },
        };
        return builder;
      },
      update: (patch: Record<string, unknown>) => {
        const entry = { patch, filters: [] as Array<[string, unknown]> };
        h.updates.push(entry);
        return {
          eq: (column: string, value: unknown) => {
            entry.filters.push([column, value]);
            return Promise.resolve({ error: h.updateError.current });
          },
        };
      },
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: (m: string) => h.toastSuccess(m),
    error: (m: string) => h.toastError(m),
  },
}));

import { SocialIdentityPanel } from "@/components/profile/identity/SocialIdentityPanel";

/** Wiersz z `get_own_profile` - domyślnie profil bez sluga i bez linków. */
function socialRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: null,
    bio_pl: null,
    bio_en: null,
    twitter_url: null,
    linkedin_url: null,
    website_url: null,
    facebook_url: null,
    instagram_url: null,
    spotify_url: null,
    contact_email: null,
    display_name: "Anna Nowak",
    first_name: "Anna",
    last_name: "Nowak",
    ...overrides,
  };
}

async function renderPanel(row: Record<string, unknown> | null = socialRow()) {
  h.rpc.mockResolvedValue({ data: row ? [row] : [], error: null });
  const view = renderWithQueryClient(<SocialIdentityPanel />);
  await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("get_own_profile"));
  return view;
}

function slugInput(): HTMLElement {
  return screen.getByLabelText("profile.social.slug");
}

function typeSlug(value: string): void {
  fireEvent.change(slugInput(), { target: { value } });
}

function saveButton(): HTMLElement {
  return screen.getByRole("button", { name: "profile.social.save" });
}

/** Zatwierdzenie tak, jak robi to użytkownik: kliknięciem przycisku. */
function saveForm(): void {
  fireEvent.click(saveButton());
}

/**
 * Zatwierdzenie POMIJAJĄCE walidację natywną przeglądarki.
 *
 * Panel ma DWIE warstwy sprawdzeń i to jest celowe: pola linków są
 * `type="url"`, a e-mail `type="email"`, więc przeglądarka sama wstrzymuje
 * zatwierdzenie przy złym formacie (warstwa pierwsza) - i dlatego kliknięcie
 * przycisku NIGDY nie dochodzi do sprawdzeń w `save()`. Warstwa druga (JS) jest
 * zaporą na wypadek zatwierdzenia programowego, autouzupełnienia wstawiającego
 * wartość bez zdarzenia oraz przeglądarki traktującej `type="url"` jak `text`.
 * Testy warstwy pierwszej asertują ATRYBUT pola, testy warstwy drugiej jadą tą
 * funkcją - inaczej połowa walidacji zapisu nie byłaby sprawdzona wcale.
 */
function submitForm(): void {
  const form = document.querySelector("form");
  if (!form) throw new Error("test: brak formularza w drzewie");
  fireEvent.submit(form);
}

function lastUpdate() {
  return h.updates.at(-1);
}

beforeEach(() => {
  h.user.current = { id: PROFILE_IDS.me, email: "anna.nowak@example.test" };
  h.rpc.mockReset();
  h.tenantRow.current = { tenant_id: PROFILE_IDS.tenant };
  h.domainRow.current = { domain: "neweuropeanstrategies.eu" };
  h.slugTaken.current = false;
  h.slugChecks.length = 0;
  h.updates.length = 0;
  h.updateError.current = null;
  h.toastSuccess.mockReset();
  h.toastError.mockReset();
});

describe("odczyt profilu", () => {
  it("czyta własny wiersz przez SECURITY DEFINER RPC (kolumna PII `contact_email`)", async () => {
    await renderPanel(socialRow({ contact_email: "kontakt@example.test", slug: "anna-nowak" }));

    expect(h.rpc).toHaveBeenCalledWith("get_own_profile");
    expect(screen.getByLabelText(/profile\.social\.email/)).toHaveValue("kontakt@example.test");
  });

  it("wypełnia bio w obu językach i linki", async () => {
    await renderPanel(
      socialRow({
        bio_pl: "Polskie bio",
        bio_en: "English bio",
        linkedin_url: "https://linkedin.com/in/anna",
      }),
    );

    expect(screen.getByLabelText("profile.social.bioPl")).toHaveValue("Polskie bio");
    expect(screen.getByLabelText("profile.social.bioEn")).toHaveValue("English bio");
    expect(screen.getByLabelText(/profile\.social\.linkedin/)).toHaveValue(
      "https://linkedin.com/in/anna",
    );
  });

  it("BRAK wiersza zostawia pusty formularz", async () => {
    await renderPanel(null);
    expect(slugInput()).toHaveValue("");
  });

  it("bez sesji nie woła RPC o profil", () => {
    h.user.current = null;
    renderWithQueryClient(<SocialIdentityPanel />);
    expect(h.rpc).not.toHaveBeenCalled();
  });
});

describe("podgląd publicznego adresu", () => {
  it("używa KANONICZNEJ domeny tenanta, nie adresu okna", async () => {
    // Pułapka 2. Adres pokazany tutaj użytkownik kopiuje do wizytówki.
    await renderPanel(socialRow({ slug: "anna-nowak" }));

    await waitFor(() =>
      expect(
        screen.getByText("https://neweuropeanstrategies.eu/author/anna-nowak"),
      ).toBeInTheDocument(),
    );
  });

  it("spada na adres okna, gdy tenant nie ma domeny", async () => {
    h.domainRow.current = { domain: null };
    await renderPanel(socialRow({ slug: "anna-nowak" }));

    await waitFor(() =>
      expect(screen.getByText(new RegExp(`/author/anna-nowak$`))).toBeInTheDocument(),
    );
    expect(screen.queryByText(/neweuropeanstrategies\.eu/)).not.toBeInTheDocument();
  });

  it("spada na adres okna, gdy profil nie ma tenanta", async () => {
    h.tenantRow.current = { tenant_id: null };
    await renderPanel(socialRow({ slug: "anna-nowak" }));

    await waitFor(() =>
      expect(screen.getByText(new RegExp(`/author/anna-nowak$`))).toBeInTheDocument(),
    );
  });

  it("pusta domena po przycięciu też schodzi na adres okna", async () => {
    h.domainRow.current = { domain: "   " };
    await renderPanel(socialRow({ slug: "anna-nowak" }));

    await waitFor(() =>
      expect(screen.getByText(new RegExp(`/author/anna-nowak$`))).toBeInTheDocument(),
    );
  });

  it("bez sluga NIE pokazuje podglądu adresu", async () => {
    // Podgląd pustego adresu (`/author/`) sugerowałby, że profil już gdzieś jest.
    await renderPanel();
    expect(screen.queryByText(/\/author\//)).not.toBeInTheDocument();
  });
});

describe("normalizacja sluga w trakcie pisania", () => {
  it("schodzi do małych liter i zamienia znaki niedozwolone na łącznik", async () => {
    // Adres jest częścią URL-a: wielkie litery i spacje dałyby dwa różne
    // adresy do tego samego profilu (albo 404 po skopiowaniu z maila).
    await renderPanel();

    typeSlug("Anna Nowak");

    expect(slugInput()).toHaveValue("anna-nowak");
  });

  it("skleja ciągi łączników w jeden", async () => {
    await renderPanel();
    typeSlug("anna   nowak");
    expect(slugInput()).toHaveValue("anna-nowak");
  });

  it("nie przyjmuje więcej znaków, niż dopuszcza kolumna", async () => {
    await renderPanel();
    expect(slugInput()).toHaveAttribute("maxlength", "64");
  });
});

describe("maszyna stanów walidacji sluga", () => {
  it("pusty slug to stan neutralny z podpowiedzią", async () => {
    await renderPanel();
    expect(screen.getByText("profile.social.slugHint")).toBeInTheDocument();
  });

  it("krótszy niż trzy znaki: „za krótki”, BEZ odpytywania bazy", async () => {
    // Zapytanie o zajętość dwuznakowego sluga to round-trip po nic - i tak
    // nie przejdzie.
    await renderPanel();

    typeSlug("ab");

    await waitFor(() =>
      expect(screen.getByText("profile.social.slugTooShort")).toBeInTheDocument(),
    );
    expect(h.slugChecks).toHaveLength(0);
  });

  it("niepoprawny kształt (łącznik na końcu) to „niepoprawny”, bez zapytania", async () => {
    await renderPanel();

    typeSlug("anna-");

    await waitFor(() => expect(screen.getByText("profile.social.slugInvalid")).toBeInTheDocument());
    expect(h.slugChecks).toHaveLength(0);
  });

  it("adres ZAREZERWOWANY jest odrzucany lokalnie, bez zapytania", async () => {
    // Słowa w rodzaju „admin” albo „profile” kolidują z trasami aplikacji.
    // Baza nie ma o nich pojęcia - w niej takiego profilu po prostu nie ma,
    // więc bez tej listy slug „admin” przeszedłby jako WOLNY.
    await renderPanel();

    typeSlug("admin");

    await waitFor(() =>
      expect(screen.getByText("profile.social.slugReserved")).toBeInTheDocument(),
    );
    expect(h.slugChecks).toHaveLength(0);
  });

  it("poprawny slug sprawdza zajętość i mówi „wolny”", async () => {
    await renderPanel();

    typeSlug("anna-nowak");

    await waitFor(() =>
      expect(screen.getByText("profile.social.slugAvailable")).toBeInTheDocument(),
    );
    expect(h.slugChecks).toHaveLength(1);
  });

  it("zapytanie o zajętość WYKLUCZA własny wiersz", async () => {
    // Bez `neq(id, mnie)` własny, już zapisany slug pokazywałby się jako
    // zajęty - użytkownik nie mógłby zapisać formularza bez zmiany adresu.
    await renderPanel(socialRow({ slug: "anna-nowak" }));

    await waitFor(() => expect(h.slugChecks.length).toBeGreaterThan(0));
    expect(h.slugChecks[0]).toEqual([
      ["slug", "anna-nowak"],
      [`neq:id`, PROFILE_IDS.me],
    ]);
  });

  it("slug zajęty przez KOGOŚ INNEGO daje „zajęty”", async () => {
    h.slugTaken.current = true;
    await renderPanel();

    typeSlug("anna-nowak");

    await waitFor(() => expect(screen.getByText("profile.social.slugTaken")).toBeInTheDocument());
  });

  it("pokazuje stan przejściowy „sprawdzam” przed odpowiedzią bazy", async () => {
    await renderPanel();

    typeSlug("anna-nowak");

    // Sprawdzenie jest opóźnione o 350 ms - bez tego stanu pole na moment
    // wyglądałoby na zaakceptowane.
    expect(screen.getByText("profile.social.slugChecking")).toBeInTheDocument();
  });

  it("szybkie pisanie odpytuje bazę RAZ, dla ostatniej wartości", async () => {
    // Bez odbicia (debounce) każde uderzenie w klawiaturę to jedno zapytanie.
    await renderPanel();

    typeSlug("ann");
    typeSlug("anna");
    typeSlug("anna-n");
    typeSlug("anna-nowak");

    await waitFor(() =>
      expect(screen.getByText("profile.social.slugAvailable")).toBeInTheDocument(),
    );
    expect(h.slugChecks).toHaveLength(1);
    expect(h.slugChecks[0][0]).toEqual(["slug", "anna-nowak"]);
  });

  it("pole niepoprawne jest oznaczone dla technologii asystujących", async () => {
    await renderPanel();

    typeSlug("ab");

    await waitFor(() => expect(slugInput()).toHaveAttribute("aria-invalid", "true"));
  });

  it("pole poprawne NIE jest oznaczone jako błędne", async () => {
    await renderPanel();

    typeSlug("anna-nowak");

    await waitFor(() =>
      expect(screen.getByText("profile.social.slugAvailable")).toBeInTheDocument(),
    );
    expect(slugInput()).not.toHaveAttribute("aria-invalid");
  });
});

describe("propozycja sluga", () => {
  it("proponuje adres z imienia i nazwiska", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "profile.social.slugReset" }));

    expect(slugInput()).toHaveValue("anna-nowak");
  });

  it("spada na `display_name`, gdy nie ma imienia i nazwiska", async () => {
    await renderPanel(
      socialRow({ first_name: null, last_name: null, display_name: "Jan Kowalski" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "profile.social.slugReset" }));

    expect(slugInput()).toHaveValue("jan-kowalski");
  });

  it("spada na lokalną część e-maila, gdy nie ma żadnej nazwy", async () => {
    await renderPanel(socialRow({ first_name: null, last_name: null, display_name: null }));

    fireEvent.click(screen.getByRole("button", { name: "profile.social.slugReset" }));

    expect(slugInput()).toHaveValue("anna-nowak");
  });

  it("REGRESJA: transliteruje litery ze znakiem, nie zjada ich", async () => {
    // „Zieliński” w URL-u bez transliteracji to procentowe escape'y - adres
    // nieczytelny i nie do przepisania z wizytówki.
    //
    // ZNALEZIONY DEFEKT (naprawiony osobnym commitem): `normalize("NFKD")`
    // rozkłada ą/ć/ę/ń/ó/ś/ź/ż, ale NIE „ł" - to nie złożenie, a osobna litera.
    // Propozycja adresu usuwała ją całkowicie: „Łukasz Zieliński" dawało
    // `ukasz-zielinski` (bez pierwszej litery), „Michał Nowak" -> `micha-nowak`,
    // „Paweł" -> `pawe`. W produkcie polskojęzycznym dotykało to najczęstszych
    // imion, a użytkownik dostawał publiczny adres z okaleczonym nazwiskiem.
    await renderPanel(socialRow({ first_name: "Łukasz", last_name: "Zieliński" }));

    fireEvent.click(screen.getByRole("button", { name: "profile.social.slugReset" }));

    expect(slugInput()).toHaveValue("lukasz-zielinski");
  });

  it("REGRESJA: „ł” w środku wyrazu też zostaje literą", async () => {
    await renderPanel(socialRow({ first_name: "Michał", last_name: "Nowak" }));

    fireEvent.click(screen.getByRole("button", { name: "profile.social.slugReset" }));

    expect(slugInput()).toHaveValue("michal-nowak");
  });

  it("REGRESJA: „ł” na końcu wyrazu nie ucina wyrazu", async () => {
    await renderPanel(socialRow({ first_name: "Paweł", last_name: "Kowalski" }));

    fireEvent.click(screen.getByRole("button", { name: "profile.social.slugReset" }));

    expect(slugInput()).toHaveValue("pawel-kowalski");
  });

  it("NIE proponuje adresu, gdy jest już identyczny z wpisanym", async () => {
    // Przycisk, który nic nie zmienia, jest szumem.
    await renderPanel(socialRow({ slug: "anna-nowak" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "profile.social.slugReset" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("propozycja NIE zapisuje się sama - dopiero po kliknięciu", async () => {
    // Automatyczny zapis sluga przy pierwszym wejściu w edycję przydzielałby
    // publiczny adres bez decyzji użytkownika.
    await renderPanel();

    expect(slugInput()).toHaveValue("");
    expect(h.updates).toHaveLength(0);
  });
});

describe("blokada zapisu i komunikaty", () => {
  it("blokujący slug WYŁĄCZA przycisk zapisu (warstwa pierwsza)", async () => {
    // Tak wygląda blokada dla użytkownika: przycisku po prostu nie da się
    // kliknąć. Dopiero test niżej sprawdza, co powie `save()`, gdy jednak
    // zostanie wywołany.
    await renderPanel();

    typeSlug("ab");
    await waitFor(() =>
      expect(screen.getByText("profile.social.slugTooShort")).toBeInTheDocument(),
    );

    expect(saveButton()).toBeDisabled();
    saveForm();
    await waitFor(() => expect(h.updates).toHaveLength(0));
  });

  it("przycisk jest wyłączony także w trakcie SPRAWDZANIA zajętości", async () => {
    // Zapis w trakcie sprawdzania mógłby przejść ze slugiem, który okaże się
    // zajęty - i wtedy o kolizji dowiaduje się dopiero unikalny indeks.
    await renderPanel();

    typeSlug("anna-nowak");

    expect(screen.getByText("profile.social.slugChecking")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });

  it("każdy stan blokujący ma SWÓJ komunikat (warstwa druga)", async () => {
    // Pułapka 1: czterostopniowy łańcuch `?:` wybierający klucz i18n.
    // Przestawienie gałęzi wysyła użytkownika w złą stronę - „adres zajęty"
    // dla adresu ZAREZERWOWANEGO każe mu próbować wariantów tego samego słowa.
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["ab", "profile.social.slugTooShort"],
      ["admin", "profile.social.slugReserved"],
      ["anna-", "profile.social.slugInvalid"],
    ];
    for (const [value, key] of cases) {
      h.toastError.mockReset();
      h.updates.length = 0;
      const view = await renderPanel();
      typeSlug(value);
      await waitFor(() => expect(screen.getByText(key)).toBeInTheDocument());

      submitForm();

      await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(key));
      expect(h.updates).toHaveLength(0);
      view.unmount();
    }
  });

  it("slug ZAJĘTY blokuje zapis komunikatem o zajętości", async () => {
    h.slugTaken.current = true;
    await renderPanel();

    typeSlug("anna-nowak");
    await waitFor(() => expect(screen.getByText("profile.social.slugTaken")).toBeInTheDocument());
    expect(saveButton()).toBeDisabled();

    submitForm();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith("profile.social.slugTaken"));
    expect(h.updates).toHaveLength(0);
  });

  it("pola linków mają `type=url`, więc przeglądarka sama wstrzymuje zły format", async () => {
    // Warstwa pierwsza walidacji - ta, która działa przy kliknięciu przycisku.
    await renderPanel();

    for (const key of ["linkedin", "spotify", "facebook", "instagram", "website"]) {
      expect(screen.getByLabelText(new RegExp(`profile\\.social\\.${key}`))).toHaveAttribute(
        "type",
        "url",
      );
    }
    expect(screen.getByLabelText(/profile\.social\.email/)).toHaveAttribute("type", "email");
  });

  it("odrzuca link bez schematu http(s), NAZYWAJĄC pole", async () => {
    // Link „linkedin.com/in/anna” bez schematu jest w HTML-u adresem
    // RELATYWNYM - klik prowadzi w obrębie naszej domeny, na 404.
    await renderPanel();

    fireEvent.change(screen.getByLabelText(/profile\.social\.linkedin/), {
      target: { value: "linkedin.com/in/anna" },
    });
    submitForm();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(String(h.toastError.mock.calls[0][0])).toContain("linkedin_url");
    expect(h.updates).toHaveLength(0);
  });

  it("sprawdza WSZYSTKIE pola linków, nie tylko pierwsze", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText(/profile\.social\.spotify/), {
      target: { value: "spotify.com/artist" },
    });
    submitForm();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(String(h.toastError.mock.calls[0][0])).toContain("spotify_url");
  });

  it("odrzuca e-mail kontaktowy w złym formacie", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText(/profile\.social\.email/), {
      target: { value: "anna-at-example" },
    });
    submitForm();

    await waitFor(() => expect(h.toastError).toHaveBeenCalledTimes(1));
    expect(String(h.toastError.mock.calls[0][0])).toContain("contact_email");
    expect(h.updates).toHaveLength(0);
  });

  it("PUSTE pola nie są walidowane jako błędne", async () => {
    // Profil bez LinkedIna jest normalny - pusty łańcuch nie może blokować.
    await renderPanel();

    saveForm();

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(h.toastError).not.toHaveBeenCalled();
  });
});

describe("zapis", () => {
  it("zapisuje zawężone do własnego wiersza i potwierdza", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText("profile.social.bioPl"), {
      target: { value: "Nowe bio" },
    });
    saveForm();

    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalledWith("profile.social.saved"));
    expect(lastUpdate()?.filters).toEqual([["id", PROFILE_IDS.me]]);
    expect(lastUpdate()?.patch).toMatchObject({ bio_pl: "Nowe bio" });
  });

  it("PUSTY slug zapisuje się jako NULL, nie jako pusty napis", async () => {
    // Kolumna `slug` ma unikalny indeks: pusty napis zająłby adres
    // `/author/` dla pierwszego konta, które zapisze formularz bez adresu.
    await renderPanel();

    saveForm();

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate()?.patch.slug).toBeNull();
  });

  it("slug zapisuje się małymi literami i bez spacji na brzegach", async () => {
    await renderPanel();

    typeSlug("Anna-Nowak");
    await waitFor(() =>
      expect(screen.getByText("profile.social.slugAvailable")).toBeInTheDocument(),
    );
    saveForm();

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate()?.patch.slug).toBe("anna-nowak");
  });

  it("zapisuje bio w OBU językach jako osobne kolumny", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText("profile.social.bioPl"), { target: { value: "PL" } });
    fireEvent.change(screen.getByLabelText("profile.social.bioEn"), { target: { value: "EN" } });
    saveForm();

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate()?.patch).toMatchObject({ bio_pl: "PL", bio_en: "EN" });
  });

  it("błąd zapisu pokazuje KOMUNIKAT SERWERA, nie własny tekst", async () => {
    // Kolizja unikalnego indeksu na `slug` to jedyny błąd, który powie
    // użytkownikowi, co się stało - własny komunikat by go zgubił.
    h.updateError.current = { message: "duplicate key value violates unique constraint" };
    await renderPanel();

    saveForm();

    await waitFor(() =>
      expect(h.toastError).toHaveBeenCalledWith("duplicate key value violates unique constraint"),
    );
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("bez sesji formularz nie zapisuje", async () => {
    h.user.current = null;
    renderWithQueryClient(<SocialIdentityPanel />);

    saveForm();

    await waitFor(() => expect(h.updates).toHaveLength(0));
  });

  it("poprawne linki przechodzą walidację i lecą do bazy", async () => {
    await renderPanel();

    fireEvent.change(screen.getByLabelText(/profile\.social\.linkedin/), {
      target: { value: "https://linkedin.com/in/anna" },
    });
    fireEvent.change(screen.getByLabelText(/profile\.social\.email/), {
      target: { value: "anna@example.test" },
    });
    saveForm();

    await waitFor(() => expect(h.updates).toHaveLength(1));
    expect(lastUpdate()?.patch).toMatchObject({
      linkedin_url: "https://linkedin.com/in/anna",
      contact_email: "anna@example.test",
    });
  });
});
