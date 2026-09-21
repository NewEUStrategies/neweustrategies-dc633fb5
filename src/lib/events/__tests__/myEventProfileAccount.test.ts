// Panel uczestnika - MIGAWKA KONTA, GRUPY i LINKI, czyli reszta kontraktu RPC.
//
// PO CO TEN PLIK OBOK `myEventProfileApi.test.ts`. Tamten opisuje profil i stan
// zgloszenia. Tutaj stoja trzy powierzchnie, ktore do dzis nie byly parsowane
// ani razu, a kazda dotyka DANYCH OSOBOWYCH albo dostepu:
//
//   1. „UZUPELNIJ Z KONTA" (`event_my_event_profile_sync_account`) przenosi
//      dane z konta platformy do kartoteki wydarzenia. Jesli slug nie dojedzie
//      w ladunku, zapis idzie w nie to wydarzenie.
//   2. MIGAWKA KONTA (`account`) jest zrodlem podpowiedzi w formularzu. Pole,
//      ktorego parser nie czyta, znika z podpowiedzi po cichu - uczestnik
//      wpisuje je recznie i nie wie, ze mial je gotowe.
//   3. GRUPY ZGLOSZENIA sa PRZEPUSTKA (sesje, strefy, gielda spotkan).
//      Wlasciciel ma widziec te same etykiety, ktore widza inni.
//
// ZAWEZENIE NAJEMCA I TOZSAMOSCIA siedzi w SQL - wszystkie trzy funkcje ida
// przez RPC `event_my_*` liczone dla `auth.uid()` i nie przyjmuja cudzej
// tozsamosci. Tutaj asertujemy NAZWE RPC i LADUNEK; zawezenia pilnuje bramka
// `check:sql-tenant-scope`.
//
// RODO: dane syntetyczne, adresy wylacznie w `example.com`.
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` jest hoistowane ponad importy - stan atrapy musi zyc w `vi.hoisted`.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import {
  SOCIAL_KEYS,
  fetchMyAgenda,
  fetchMyEventProfile,
  saveMyEventProfile,
  syncMyEventProfileFromAccount,
} from "@/lib/events/myEventProfileApi";

const PUSTY_PANEL = { profile: null, account: null, registration: null };

beforeEach(() => {
  rpc.mockReset();
});

describe("migawka konta platformy - zrodlo dla 'Uzupelnij z konta'", () => {
  it("czyta komplet pol, ktore formularz potrafi podpowiedziec", async () => {
    // Pole nieczytane przez parser znika z podpowiedzi bez sladu: uczestnik
    // wpisuje je recznie, a formularz wyglada, jakby konto bylo puste.
    rpc.mockResolvedValue({
      data: {
        account: {
          first_name: "Ewa",
          last_name: "Testowa",
          email: "ewa.testowa@example.com",
          phone: "+48 500 000 001",
          job_title: "Analityk",
          company_id: "c1",
          company_text: "Firma Przykladowa",
          specialization: "Regulacje",
          seeking_pl: "Szukam partnerow",
          seeking_en: "Looking for partners",
          offering_pl: "Oferuje analizy",
          offering_en: "Offering analysis",
          photo_url: "https://cdn.example.com/ewa.jpg",
          bio_pl: "Nota po polsku",
          bio_en: "Bio in English",
          social_links: { linkedin: "https://example.com/in/ewa" },
        },
      },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.account).toEqual({
      firstName: "Ewa",
      lastName: "Testowa",
      email: "ewa.testowa@example.com",
      phone: "+48 500 000 001",
      jobTitle: "Analityk",
      companyId: "c1",
      companyText: "Firma Przykladowa",
      specialization: "Regulacje",
      seekingPl: "Szukam partnerow",
      seekingEn: "Looking for partners",
      offeringPl: "Oferuje analizy",
      offeringEn: "Offering analysis",
      photoUrl: "https://cdn.example.com/ewa.jpg",
      bioPl: "Nota po polsku",
      bioEn: "Bio in English",
      socialLinks: { linkedin: "https://example.com/in/ewa" },
    });
  });

  it("konto bez wypelnionych pol daje same puste wartosci, nie brak migawki", async () => {
    // Roznica jest widoczna w interfejsie: `null` znaczy „nie ma konta", pusta
    // migawka znaczy „konto jest, ale nic w nim nie ma" - i wtedy przycisk
    // „Uzupelnij z konta" ma prawo byc aktywny.
    rpc.mockResolvedValue({ data: { account: {} }, error: null });

    const state = await fetchMyEventProfile("summit");

    expect(state.account).not.toBeNull();
    // Puste pole konta ma byc `null`, a nie pustym napisem: formularz odroznia
    // „nie ma czego podpowiedziec" od „podpowiedz jest pusta" i tylko w tym
    // pierwszym przypadku zostawia to, co uczestnik juz wpisal.
    expect(state.account?.firstName).toBeNull();
    expect(state.account?.email).toBeNull();
    expect(state.account?.photoUrl).toBeNull();
    expect(state.account?.socialLinks).toEqual({});
  });

  it("odpowiedz, ktora nie jest obiektem, daje pusty panel zamiast wyjatku", async () => {
    // RPC potrafi oddac `null` (brak zgloszenia na to wydarzenie). Panel ma sie
    // wtedy narysowac w stanie „nie jestes zapisany", a nie wysypac trase.
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(fetchMyEventProfile("summit")).resolves.toEqual(PUSTY_PANEL);
  });
});

describe("linki spolecznosciowe", () => {
  it("czyta wylacznie klucze z zamknietego slownika", async () => {
    // Klucz spoza slownika trafilby na wizytowke jako nieznana ikona albo
    // odnosnik bez etykiety - lista jest zamknieta wlasnie po to.
    rpc.mockResolvedValue({
      data: {
        profile: {
          person_id: "p1",
          social_links: {
            linkedin: "https://example.com/in/ewa",
            website: "https://example.org",
            myspace: "https://example.org/ewa",
            x: "   ",
            facebook: 42,
          },
        },
      },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.profile?.socialLinks).toEqual({
      linkedin: "https://example.com/in/ewa",
      website: "https://example.org",
    });
  });

  it("czyta KAZDY klucz slownika, nie tylko dwa najczestsze", async () => {
    // Serwis obecny w slowniku, a pominiety przy odczycie, znika z wizytowki
    // po cichu: uczestnik zapisuje odnosnik, dostaje potwierdzenie i nie widzi
    // go z powrotem, wiec wpisuje go drugi raz. Ladunek budujemy Z SLOWNIKA,
    // wiec przypadek pilnuje kazdej pozycji naraz - takze tej dopisanej jutro.
    const komplet: Record<string, string> = {};
    for (const key of SOCIAL_KEYS) komplet[key] = `https://example.org/${key}`;
    rpc.mockResolvedValue({
      data: {
        profile: {
          person_id: "p1",
          social_links: { ...komplet, myspace: "https://example.org/spoza-slownika" },
        },
      },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.profile?.socialLinks).toEqual(komplet);
  });

  it("linki nie bedace obiektem daja pusty zestaw, a nie polamana wizytowke", async () => {
    rpc.mockResolvedValue({
      data: { profile: { person_id: "p1", social_links: "https://example.com/in/ewa" } },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.profile?.socialLinks).toEqual({});
  });
});

describe("grupy zgloszenia - przepustka uczestnika", () => {
  it("czyta obie nazwy i kolor, bo te same etykiety widza inni uczestnicy", async () => {
    rpc.mockResolvedValue({
      data: {
        registration: {
          registration_id: "r1",
          groups: [
            { id: "g1", name_pl: "Wystawcy", name_en: "Exhibitors", color: "#123456" },
            { id: "g2", name_pl: "Prelegenci" },
          ],
        },
      },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.registration?.groups).toEqual([
      { id: "g1", namePl: "Wystawcy", nameEn: "Exhibitors", color: "#123456" },
      { id: "g2", namePl: "Prelegenci", nameEn: "", color: null },
    ]);
  });

  it("wpis bez identyfikatora odpada, a wartosc nie bedaca lista daje pusty zestaw", async () => {
    // Znacznika bez identyfikatora nie da sie powiazac z niczym po stronie bazy,
    // wiec na przepustce nie ma czego reprezentowac.
    rpc.mockResolvedValue({
      data: {
        registration: {
          registration_id: "r1",
          groups: [{ name_pl: "Bez id" }, "grupa", { id: "g3" }],
        },
      },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.registration?.groups.map((group) => group.id)).toEqual(["g3"]);
  });

  it("zgloszenie bez grup ma pusta przepustke i status 'unknown'", async () => {
    // Status nazwany wprost jest warunkiem tego, zeby panel nie pokazal
    // „zatwierdzony" komus, kto czeka na decyzje organizatora.
    rpc.mockResolvedValue({
      data: { registration: { registration_id: "r1", groups: null } },
      error: null,
    });

    const state = await fetchMyEventProfile("summit");

    expect(state.registration?.groups).toEqual([]);
    expect(state.registration?.status).toBe("unknown");
  });
});

describe("uzupelnienie kartoteki z konta platformy", () => {
  it("wola wlasne RPC ze slugiem wydarzenia w ladunku", async () => {
    // Slug jest jedynym wskazaniem wydarzenia - bez niego zapis poszedlby
    // w nie ta kartoteke. Zawezenie tozsamoscia (`auth.uid()`) i najemca siedzi
    // w SQL; pilnuje go bramka `check:sql-tenant-scope`.
    rpc.mockResolvedValue({ data: PUSTY_PANEL, error: null });
    await syncMyEventProfileFromAccount("summit");
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_sync_account", {
      p_payload: { slug: "summit" },
    });
    // Jedno wolanie, nie dwa: uzupelnienie nadpisuje puste pola kartoteki,
    // wiec powtorzone przy jednym kliknieciu potrafi cofnac poprawke wpisana
    // miedzy jednym a drugim zapisem.
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("oddaje panel po uzupelnieniu, zeby formularz nie pokazywal starych pol", async () => {
    // Bez odczytania odpowiedzi formularz zostaje na wartosciach sprzed
    // synchronizacji i uczestnik klika „Uzupelnij" po raz drugi.
    rpc.mockResolvedValue({
      data: { profile: { person_id: "p1", job_title: "Analityk" } },
      error: null,
    });

    const state = await syncMyEventProfileFromAccount("summit");

    expect(state.profile?.jobTitle).toBe("Analityk");
  });

  it("odmowa bazy wychodzi do wolajacego, zamiast udawac udane uzupelnienie", async () => {
    // Cichy sukces przy odmowie to najgorszy wariant: uczestnik widzi puste
    // pola i komunikat o powodzeniu.
    rpc.mockResolvedValue({ data: null, error: new Error("not_found: registration") });
    await expect(syncMyEventProfileFromAccount("summit")).rejects.toThrow("not_found");
  });
});

describe("odmowy bazy nie gina po drodze", () => {
  it("zapis profilu przenosi blad do wolajacego", async () => {
    // Bez tego uczestnik dostaje potwierdzenie zapisu, ktorego nie bylo -
    // i traci wpisane dane przy pierwszym przeladowaniu.
    rpc.mockResolvedValue({ data: null, error: new Error("forbidden: registration required") });
    await expect(saveMyEventProfile({ slug: "summit", job_title: "Analityk" })).rejects.toThrow(
      "forbidden",
    );
  });

  it("odczyt agendy przenosi blad do wolajacego", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("auth_required") });
    await expect(fetchMyAgenda("summit")).rejects.toThrow("auth_required");
  });
});

describe("ladunek zapisu jest plaski i zawiera tylko to, co podano", () => {
  it("pole pominiete nie pojawia sie w ladunku - brak klucza znaczy 'nie ruszaj'", async () => {
    // To jest cala roznica miedzy „nie zmieniaj telefonu" a „wyczysc telefon".
    // Doklejenie brakujacych kluczy skasowaloby dane, ktorych nikt nie ruszal.
    rpc.mockResolvedValue({ data: PUSTY_PANEL, error: null });
    await saveMyEventProfile({ slug: "summit", email_visible: true });
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_set", {
      p_payload: { slug: "summit", email_visible: true },
    });
  });

  it("linki podane jako `undefined` nie doklejaja sie do ladunku", async () => {
    // Formularz buduje wejscie warunkowo, wiec `social_links: undefined` jest
    // osiagalne. Wyslane jako klucz znaczyloby „skasuj wszystkie linki".
    rpc.mockResolvedValue({ data: PUSTY_PANEL, error: null });
    await saveMyEventProfile({ slug: "summit", social_links: undefined, bio_pl: "Nota" });
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_set", {
      p_payload: { slug: "summit", bio_pl: "Nota" },
    });
  });

  it("zgody na widocznosc kontaktu jada jako wartosci logiczne, nie jako napisy", async () => {
    // `"false"` jest w JSON-ie prawda - zgoda na pokazanie telefonu zamieniona
    // na napis wlaczylaby widocznosc, ktorej uczestnik odmowil.
    rpc.mockResolvedValue({ data: PUSTY_PANEL, error: null });
    await saveMyEventProfile({ slug: "summit", email_visible: false, phone_visible: false });
    expect(rpc).toHaveBeenCalledWith("event_my_event_profile_set", {
      p_payload: { slug: "summit", email_visible: false, phone_visible: false },
    });
  });
});

describe("moja agenda", () => {
  it("czyta komplet pol wiersza sesji", async () => {
    // Sala, sciezka i odnosnik do transmisji sa jedynym, co uczestnik ma
    // w reku na miejscu; brak ktoregokolwiek znaczy „szukaj sam".
    rpc.mockResolvedValue({
      data: {
        sessions: [
          {
            session_id: "s1",
            title_pl: "Panel otwarcia",
            title_en: "Opening panel",
            starts_at: "2026-09-01T08:00:00Z",
            ends_at: "2026-09-01T09:00:00Z",
            format: "panel",
            stream_url: "https://example.com/stream",
            room_name_pl: "Sala A",
            room_name_en: "Room A",
            track_name_pl: "Energia",
            track_name_en: "Energy",
            signup_status: "confirmed",
          },
        ],
      },
      error: null,
    });

    const [session] = await fetchMyAgenda("summit");

    expect(session).toEqual({
      sessionId: "s1",
      titlePl: "Panel otwarcia",
      titleEn: "Opening panel",
      startsAt: "2026-09-01T08:00:00Z",
      endsAt: "2026-09-01T09:00:00Z",
      format: "panel",
      streamUrl: "https://example.com/stream",
      roomNamePl: "Sala A",
      roomNameEn: "Room A",
      trackNamePl: "Energia",
      trackNameEn: "Energy",
      signupStatus: "confirmed",
    });
  });

  it("wpis nie bedacy obiektem odpada razem z wpisem bez identyfikatora", async () => {
    rpc.mockResolvedValue({
      data: { sessions: ["sesja", null, { session_id: "s1" }, { title_pl: "Bez id" }] },
      error: null,
    });

    const rows = await fetchMyAgenda("summit");

    expect(rows.map((row) => row.sessionId)).toEqual(["s1"]);
  });

  it("odpowiedz nie bedaca obiektem daje pusta agende", async () => {
    rpc.mockResolvedValue({ data: "brak sesji", error: null });
    await expect(fetchMyAgenda("summit")).resolves.toEqual([]);
  });
});
