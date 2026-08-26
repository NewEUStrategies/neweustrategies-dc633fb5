// Testy modelu nawigacji STUDIA WYDARZENIA.
//
// TU PILNUJEMY SPOJNOSCI TRZECH LIST, ktore musza opisywac ten sam zbior
// podstron: `EVENT_STUDIO_SECTIONS` (klucze lisci), `EVENT_STUDIO_ROUTES`
// (adresy) i `EVENT_STUDIO_NAV` (drzewo, ktore widzi redaktor). Rozjazd miedzy
// nimi nie wywala kompilacji - konczy sie pusta pozycja w sidebarze albo dwiema
// podswietlonymi naraz, czyli bledem, ktory widac dopiero na ekranie.
//
// NAJWAZNIEJSZY JEST TU ROZBIOR ADRESU. `eventStudioSectionFromPath` wola nie
// tylko sidebar, ale i `src/routes/admin.tsx`: to ona decyduje, czy schowac
// powloke panelu. Adres studia, ktorego ta funkcja nie rozpozna, dostaje sidebar
// panelu OBOK sidebara wydarzenia - dwa lewe pasy naraz. Dlatego testowany jest
// osobno kazdy ksztalt adresu: jednosegmentowy, dwusegmentowy, adres grupy,
// adres z prefiksem cudzej sekcji i adres o segment za dlugi.
import { describe, expect, it } from "vitest";
import {
  EVENT_STUDIO_NAV,
  EVENT_STUDIO_ROUTES,
  EVENT_STUDIO_SECTIONS,
  eventStudioNodeSections,
  eventStudioSectionFromPath,
  matchesStudioQuery,
  type EventStudioNavGroup,
} from "@/lib/events/eventStudioNav";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

const GROUPS: readonly EventStudioNavGroup[] = EVENT_STUDIO_NAV.filter(
  (node): node is EventStudioNavGroup => node.kind === "group",
);

/**
 * Klucz sekcji -> ogon adresu, ktorego ma dotyczyc.
 *
 * Regula nazewnicza modelu: klucz jest camelCase-owym zapisem sciezki, wiec
 * `registrationTickets` moze stac WYLACZNIE pod `registration/tickets`. Test
 * liczy to sam, zamiast powtarzac tablice adresow - inaczej sprawdzalby, czy
 * kopia zgadza sie z kopia.
 */
function expectedTail(section: string): string {
  return section.replace(/[A-Z]/g, (letter) => `/${letter.toLowerCase()}`);
}

describe("rozpoznanie sekcji studia po adresie", () => {
  it("czyta adres JEDNOSEGMENTOWY", () => {
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/general`)).toBe("general");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/pages`)).toBe("pages");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/communications`)).toBe(
      "communications",
    );
  });

  it("czyta adres DWUSEGMENTOWY podstrony w grupie", () => {
    // Sedno tej zmiany: kazda podstrona ma wlasny adres, wiec rozbior adresu
    // musi widziec oba segmenty. Zatrzymanie sie na pierwszym dawaloby
    // „jestem w Rejestracji" na kazdym z trzech jej ekranow.
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/registration/tickets`)).toBe(
      "registrationTickets",
    );
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/content/conflicts`)).toBe(
      "contentConflicts",
    );
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/onsite/checkpoints`)).toBe(
      "onsiteCheckpoints",
    );
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/meetings/list`)).toBe(
      "meetingsList",
    );
  });

  it("rozpoznaje ADRES GRUPY i wskazuje jej pozycje domyslna", () => {
    // Adres grupy jest legalny (trasa indeksowa przekierowuje na pierwsze
    // dziecko). Gdyby nie byl rozpoznawany, `admin.tsx` na czas przekierowania
    // dorysowalby powloke panelu z jej wlasnym sidebarem.
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/registration`)).toBe(
      "registrationList",
    );
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/content`)).toBe("contentSessions");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/meetings`)).toBe("meetingsTables");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/onsite`)).toBe("onsiteDesk");
  });

  it("nie podswietla sekcji `pages` na adresie zaczynajacym sie tak samo", () => {
    // Regula z komentarza modulu: dopasowanie po `startsWith` zapalaloby
    // `pages` takze na `.../pages-and-menu`, czyli dwie pozycje sidebara naraz.
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/pages-and-menu`)).toBeNull();
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/general-settings`)).toBeNull();
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/registration-mode`)).toBeNull();
    expect(
      eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/registration/ticket-types`),
    ).toBeNull();
  });

  it("znosi konczacy ukosnik", () => {
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/branding/`)).toBe("branding");
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/content/rooms/`)).toBe(
      "contentRooms",
    );
  });

  it("zwraca null dla segmentu spoza zamknietej listy sekcji", () => {
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/settings`)).toBeNull();
    // „tickets" istnieje TYLKO pod „registration" - samodzielnie nie jest adresem.
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/tickets`)).toBeNull();
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/content/people`)).toBeNull();
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/builder`)).toBeNull();
  });

  it("zwraca null dla adresu spoza studia", () => {
    expect(eventStudioSectionFromPath("/admin/events/list")).toBeNull();
    expect(eventStudioSectionFromPath("/admin/events")).toBeNull();
    expect(eventStudioSectionFromPath("/admin/pages/general")).toBeNull();
    expect(eventStudioSectionFromPath("/general")).toBeNull();
    expect(eventStudioSectionFromPath("")).toBeNull();
  });

  it("zwraca null, gdy adres jest o segment za dlugi", () => {
    // Szczegol rekordu (`.../content/sessions/<id>`) NIE ma wlasnej pozycji
    // w sidebarze - i celowo nie oddaje jej sekcji nadrzednej, bo trzeci poziom
    // adresu nie jest jeszcze zaimplementowany.
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/pages/edit`)).toBeNull();
    expect(eventStudioSectionFromPath(`/admin/events/${EVENT_ID}/content/sessions/abc`)).toBeNull();
  });
});

describe("tablica adresow sekcji studia", () => {
  it("ma wpis dla KAZDEJ sekcji i nie ma wpisow nadmiarowych", () => {
    expect(Object.keys(EVENT_STUDIO_ROUTES).sort()).toEqual([...EVENT_STUDIO_SECTIONS].sort());
  });

  it("kazdy adres stoi w przestrzeni jednego wydarzenia i konczy sie WLASNYM segmentem", () => {
    for (const section of EVENT_STUDIO_SECTIONS) {
      const route = EVENT_STUDIO_ROUTES[section];
      expect(route).toBe(`/admin/events/$eventId/${expectedTail(section)}`);
    }
  });

  it("adres po podstawieniu identyfikatora wraca do tej samej sekcji", () => {
    // Domkniecie petli: tablica adresow i rozpoznanie adresu nie moga sie
    // rozjechac, bo wtedy sidebar prowadzi tam, gdzie nic sie nie podswietla.
    for (const section of EVENT_STUDIO_SECTIONS) {
      const pathname = EVENT_STUDIO_ROUTES[section].replace("$eventId", EVENT_ID);
      expect(eventStudioSectionFromPath(pathname)).toBe(section);
    }
  });
});

describe("drzewo nawigacji studia", () => {
  const sections = EVENT_STUDIO_NAV.flatMap((node) => eventStudioNodeSections(node));

  it("kazda pozycja wskazuje sekcje istniejaca na liscie sekcji", () => {
    for (const section of sections) {
      expect(EVENT_STUDIO_SECTIONS).toContain(section);
    }
  });

  it("kazda sekcja stoi w nawigacji DOKLADNIE RAZ", () => {
    // Sekcja powtorzona w dwoch grupach dalaby dwie podswietlone pozycje dla
    // jednego adresu; sekcja pominieta bylaby ekranem bez wejscia z sidebara.
    expect(sections.length).toBe(EVENT_STUDIO_SECTIONS.length);
    expect([...new Set(sections)].sort()).toEqual([...EVENT_STUDIO_SECTIONS].sort());
  });

  it("kazda GRUPA ma niepusta liste dzieci", () => {
    // Grupa bez dzieci to naglowek ze strzalka, po ktorej rozwinieciu nie ma nic.
    expect(GROUPS.length).toBeGreaterThan(0);
    for (const group of GROUPS) {
      expect(group.entries.length, `grupa ${group.key} bez dzieci`).toBeGreaterThan(0);
    }
  });

  it("pozycja domyslna grupy jest jej PIERWSZYM dzieckiem", () => {
    // Klikniecie w nazwe grupy prowadzi na `defaultSection`. Wskazanie innego
    // dziecka niz pierwsze znaczyloby, ze sidebar podswietla trzecia pozycje
    // po klikniecu w naglowek - i nikt nie wie dlaczego.
    for (const group of GROUPS) {
      expect(group.defaultSection, `grupa ${group.key}`).toBe(group.entries[0]?.key);
    }
  });

  it("adres grupy jest prefiksem adresow WSZYSTKICH jej dzieci", () => {
    // Grupa `builder` jest wyjatkiem swiadomym: jej dzieci leza na najwyzszym
    // poziomie (`.../general`), bo tak samo jest we wzorcu.
    for (const group of GROUPS) {
      const tails = group.entries.map((entry) =>
        EVENT_STUDIO_ROUTES[entry.key].split("/").slice(4),
      );
      const prefixes = new Set(tails.map((tail) => (tail.length > 1 ? tail[0] : "")));
      expect(prefixes.size, `grupa ${group.key} miesza przestrzenie adresow`).toBe(1);
    }
  });

  it("kazda pozycja niesie klucz i18n, a nie gotowy napis", () => {
    for (const node of EVENT_STUDIO_NAV) {
      expect(node.labelKey).toMatch(/^adminEvent[A-Za-z]*\.[a-z]/);
      expect(node.icon.trim()).not.toBe("");
      if (node.kind === "group") {
        for (const entry of node.entries) {
          expect(entry.labelKey).toMatch(/^adminEvent[A-Za-z]*\.[a-z]/);
        }
      }
    }
  });

  it("klucze wezlow najwyzszego poziomu sa unikalne", () => {
    const keys = EVENT_STUDIO_NAV.map((node) => node.key);
    expect([...new Set(keys)]).toHaveLength(keys.length);
  });
});

describe("filtr wyszukiwarki studia", () => {
  it("puste zapytanie przepuszcza wszystko", () => {
    expect(matchesStudioQuery("", "Rejestracja", ["bilety"])).toBe(true);
    expect(matchesStudioQuery("   ", "Rejestracja")).toBe(true);
    expect(matchesStudioQuery("", "")).toBe(true);
  });

  it("znajduje sekcje po slowie kluczowym, nie tylko po etykiecie", () => {
    // Sens `keywordKeys`: „bilety" maja prowadzic do zapisow, choc na ekranie
    // nie ma slowa „bilety".
    expect(matchesStudioQuery("bilety", "Rejestracja", ["bilety", "zapisy"])).toBe(true);
    expect(matchesStudioQuery("bilety", "Rejestracja", [])).toBe(false);
  });

  it("trafia w PODPOZYCJE po jej wlasnym slowie kluczowym", () => {
    // Dwa poziomy znacza, ze wyszukiwarka musi siegac na drugi: „oblozenie"
    // nie stoi w zadnej etykiecie, a ma prowadzic wprost do statystyk spotkan.
    const stats = GROUPS.find((group) => group.key === "meetings")?.entries.find(
      (entry) => entry.key === "meetingsStats",
    );
    expect(stats?.keywordKeys ?? []).not.toHaveLength(0);
    expect(
      matchesStudioQuery("obłożenie", "Statystyki", ["wykorzystanie stolików, obłożenie"]),
    ).toBe(true);
    expect(matchesStudioQuery("obłożenie", "Statystyki", ["QR, skaner"])).toBe(false);
  });

  it("nie rozroznia wielkosci liter po zadnej stronie", () => {
    expect(matchesStudioQuery("REJESTR", "Rejestracja")).toBe(true);
    expect(matchesStudioQuery("qr", "Odprawa", ["Kody QR"])).toBe(true);
    expect(matchesStudioQuery("Kody Qr", "Odprawa", ["kody qr"])).toBe(true);
  });

  it("dopasowuje fragment w srodku wyrazu", () => {
    expect(matchesStudioQuery("jestr", "Rejestracja")).toBe(true);
    expect(matchesStudioQuery("ndin", "Branding")).toBe(true);
  });

  it("obcina biale znaki zapytania przed porownaniem", () => {
    expect(matchesStudioQuery("  branding  ", "Branding")).toBe(true);
  });

  it("odrzuca zapytanie, ktorego nie ma ani w etykiecie, ani w slowach", () => {
    expect(matchesStudioQuery("faktura", "Rejestracja", ["bilety", "zapisy"])).toBe(false);
  });
});
