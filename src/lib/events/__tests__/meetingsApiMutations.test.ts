// Gielda spotkan 1-1: operacje ZABIERAJACE wiersz (stolik, okno dostepnosci)
// i PRZELACZNIK obecnosci uczestnika w katalogu.
//
// DLACZEGO OSOBNY PLIK OBOK `meetingsApi.test.ts`. Tamten pilnuje NAZW KLUCZY
// w payloadach zapisow - tutaj chodzi o cos innego: o to, CO SIE DZIEJE, gdy
// baza odmawia, i o to, ktora wartosc wraca na ekran. Te dwie rzeczy psuja sie
// niezaleznie od siebie.
//
// TRZY POWODY, DLA KTORYCH TEN PLIK ISTNIEJE:
//
//   * STOLIK I OKNO DOSTEPNOSCI SA ODRZUCANE, NIE KASOWANE KASKADOWO. SQL
//     podnosi `table_in_use` przy stoliku, przy ktorym stoja spotkania, oraz
//     `availability_has_meetings` przy oknie, w ktorym siedzi spotkanie
//     (migracje 20260825063440 i 20260825063817). Kaskada zostawilaby umowione
//     spotkania bez stolika albo poza jakakolwiek dostepnoscia - czyli obie
//     strony przyszlyby na rozmowe, ktorej system juz nie planuje.
//   * `event_meeting_directory_visibility_set` STERUJE WIDOCZNOSCIA CZLOWIEKA
//     dla innych uczestnikow (`event_registrations.directory_opt_out`).
//     Przelaczenie w zla strone pokazuje w katalogu kogos, kto sie z niego
//     wypisal.
//   * ODPOWIEDZ EKRANU MA POCHODZIC Z BAZY, NIE Z ZYCZENIA WOLAJACEGO.
//
// ZAWEZENIE NAJEMCEM SIEDZI W SQL-u: `assert_editor_tenant()` w funkcjach
// panelu, `public_tenant_id()` + `auth.uid()` w funkcji uczestnika, i
// `tenant_id = v_tenant` w kazdym WHERE. Pilnuje tego bramka
// `check:sql-tenant-scope` - klient nie ma czym tego zawezenia podac.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as ReturnType<typeof import("@/test/supabase/rpc").supabaseRpcStub> | null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

const api = await import("@/lib/events/meetingsApi");

const STOLIK = "88888888-8888-8888-8888-888888888888";
const OKNO = "99999999-9999-9999-9999-999999999999";
const ZAPIS = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SLUG = "kongres-testowy";
const WYDARZENIE = "abababab-abab-abab-abab-abababababab";

function rpc(): NonNullable<typeof h.rpc> {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie została ustawiona");
  return h.rpc;
}

function payloadOf(nazwa: string): Record<string, unknown> {
  const call = rpc().lastCall(nazwa);
  expect(call, `brak wywołania RPC ${nazwa}`).toBeDefined();
  const p = call?.arg("p_payload");
  expect(p !== null && typeof p === "object", `${nazwa}: payload nie jest obiektem`).toBe(true);
  return p as Record<string, unknown>;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
});

describe("meetingsApi - usuwanie stolika", () => {
  it("stolik znika własną funkcją bazy, z identyfikatorem jako `_id`", async () => {
    rpc().setData("admin_event_meeting_table_delete", true);

    await expect(api.deleteMeetingTable(STOLIK)).resolves.toBe(true);
    expect(rpc().names()).toEqual(["admin_event_meeting_table_delete"]);
    expect(rpc().lastCall("admin_event_meeting_table_delete")?.keys()).toEqual(["_id"]);
    expect(rpc().lastCall("admin_event_meeting_table_delete")?.arg("_id")).toBe(STOLIK);
  });

  it("stolik z zaplanowanymi spotkaniami: baza odmawia, spotkania zostają", async () => {
    rpc().setError(
      "admin_event_meeting_table_delete",
      "table_in_use: 5 meeting(s) still reference this table",
    );

    // FAKTYCZNY kontrakt: odmowa z liczba spotkan, a nie kaskada. Wlasciwa
    // sciezka dla organizatora to WYLACZENIE stolika (`is_active`), bo wtedy
    // umowione rozmowy zachowuja miejsce, a nowe juz go nie dostana.
    await expect(api.deleteMeetingTable(STOLIK)).rejects.toThrow(/^table_in_use: 5/);
    // Zadnego odwolywania spotkan „przy okazji" (`admin_event_meeting_set_status`),
    // zadnego cichego wygaszania stolika (`admin_event_meeting_table_save`) ani
    // zadnego innego zapisu naprawczego - to decyzja organizatora, nie skutek
    // uboczny klikniecia w kosz. Dlatego asercja idzie na CALA liste wywolan.
    expect(rpc().names()).toEqual(["admin_event_meeting_table_delete"]);
  });

  // DEFEKT ZAREJESTROWANY, NIE NAPRAWIONY (`it.fails`).
  //
  // `deleteMeetingTable` (`meetingsApi.ts:100-104`) czyta z odpowiedzi WYLACZNIE
  // `error` i zwraca stale `true`. Funkcja bazy jest zadeklarowana jako
  // `RETURNS boolean`, wiec jej odpowiedz jest realnym kanalem informacji
  // „usunieto / nie usunieto" - i ten kanal jest tu wyrzucany. Skutek: kazda
  // odpowiedz bez bledu, takze `false`, dojedzie do panelu jako sukces, panel
  // zdejmie stolik z listy, a wiersz zostanie w bazie do nastepnego
  // odswiezenia. Siostrzane modulu robia to poprawnie: `deleteEventSession`
  // (`sessionsApi.ts:314-318`) oddaje `Boolean(data)`, a `deleteSponsor`
  // (`sponsorsApi.ts:250-254`) oddaje `data === true`. Poprawka nalezy do
  // produkcji: odpowiedz bazy ma byc oddana, a nie nadpisana.
  it.fails("DEFEKT: `false` z bazy jest raportowane jako udane usunięcie stolika", async () => {
    rpc().setData("admin_event_meeting_table_delete", false);

    await expect(api.deleteMeetingTable(STOLIK)).resolves.toBe(false);
  });
});

describe("meetingsApi - usuwanie okna dostępności uczestnika", () => {
  it("okno znika własną funkcją bazy, z identyfikatorem jako `_id`", async () => {
    rpc().setData("admin_event_meeting_availability_delete", true);

    await expect(api.deleteAdminAvailability(OKNO)).resolves.toBe(true);
    expect(rpc().names()).toEqual(["admin_event_meeting_availability_delete"]);
    expect(rpc().lastCall("admin_event_meeting_availability_delete")?.keys()).toEqual(["_id"]);
    expect(rpc().lastCall("admin_event_meeting_availability_delete")?.arg("_id")).toBe(OKNO);
  });

  it("okno z umówionym spotkaniem: baza odmawia, spotkanie nie zostaje bez dostępności", async () => {
    rpc().setError(
      "admin_event_meeting_availability_delete",
      "availability_has_meetings: 2 meeting(s) sit inside this window",
    );

    // SQL liczy spotkania w stanach `invited/accepted/held/no_show`, ktore
    // nachodza na okno. Usuniecie okna „na sile" zostawiloby przyjete
    // spotkanie poza kazda zadeklarowana dostepnoscia - gielda przestalaby je
    // widziec przy szukaniu kolejnych terminow.
    await expect(api.deleteAdminAvailability(OKNO)).rejects.toThrow(
      /^availability_has_meetings: 2/,
    );
    // Ani przyciecia okna „dookola" spotkania (`admin_event_meeting_availability_set`),
    // ani zadnego innego zapisu naprawczego: odmowa jest calym skutkiem.
    expect(rpc().names()).toEqual(["admin_event_meeting_availability_delete"]);
  });

  // DEFEKT ZAREJESTROWANY, NIE NAPRAWIONY (`it.fails`).
  //
  // To samo, co przy stoliku: `deleteAdminAvailability`
  // (`meetingsApi.ts:515-519`) ignoruje `data` i zwraca stale `true`.
  // Organizator wpisuje okna dostepnosci ZA uczestnika bez konta, wiec to jest
  // jedyny ekran, na ktorym widac te dane - „usunieto" bez usuniecia znaczy
  // tutaj, ze gielda dalej proponuje termin, ktorego uczestnik juz nie ma.
  it.fails("DEFEKT: `false` z bazy jest raportowane jako udane usunięcie okna", async () => {
    rpc().setData("admin_event_meeting_availability_delete", false);

    await expect(api.deleteAdminAvailability(OKNO)).resolves.toBe(false);
  });
});

describe("meetingsApi - widoczność uczestnika w katalogu giełdy", () => {
  it("wpisanie się do katalogu wysyła jawne `listed: true` i oddaje odpowiedź bazy", async () => {
    rpc().setData("event_meeting_directory_visibility_set", {
      registration_id: ZAPIS,
      listed: true,
    });

    await expect(
      api.setMeetingDirectoryVisibility({ eventSlug: SLUG, listed: true }),
    ).resolves.toBe(true);
    const p = payloadOf("event_meeting_directory_visibility_set");
    expect(p).toEqual({ event_slug: SLUG, listed: true });
    // Komplet kluczy asertowany osobno, bo `toEqual` nie odroznia „klucza nie
    // bylo" od „klucz z wartoscia undefined". Wydarzenie wskazane slugiem MA
    // dojechac bez `event_id`: funkcja rozstrzyga po tym, co dostala, a pusty
    // `event_id` obok slugu to gotowa niejednoznacznosc.
    expect(Object.keys(p).sort()).toEqual(["event_slug", "listed"]);
  });

  it("wypisanie się wysyła jawne `listed: false` i oddaje `false`", async () => {
    rpc().setData("event_meeting_directory_visibility_set", {
      registration_id: ZAPIS,
      listed: false,
    });

    await expect(
      api.setMeetingDirectoryVisibility({ eventSlug: SLUG, listed: false }),
    ).resolves.toBe(false);
    const p = payloadOf("event_meeting_directory_visibility_set");
    // `v_listed := (NULLIF(p_payload->>'listed',''))::boolean` i wyjatek
    // `invalid_payload`, gdy wyjdzie NULL. Jawne `false` to JEDYNA droga do
    // `directory_opt_out = true`, czyli do znikniecia z katalogu.
    expect("listed" in p).toBe(true);
    expect(p.listed).toBe(false);
  });

  it("przełącznik nie niesie tożsamości uczestnika ani niczego poza flagą", async () => {
    rpc().setData("event_meeting_directory_visibility_set", { listed: true });

    await api.setMeetingDirectoryVisibility({ eventId: WYDARZENIE, listed: true });

    // Zapis, ktorego dotyczy zmiana, baza wyprowadza z `auth.uid()`. Gdyby
    // klient dosylal tu wlasny `registration_id`, przelacznik prywatnosci
    // dostalby parametr sterowany z przegladarki - czyli droge do przestawienia
    // widocznosci CUDZEGO zapisu.
    expect(Object.keys(payloadOf("event_meeting_directory_visibility_set")).sort()).toEqual([
      "event_id",
      "listed",
    ]);
  });

  it("odpowiedź bierze się z bazy, a nie z życzenia wołającego", async () => {
    // Uczestnik prosi o wpisanie do katalogu, baza zostawia go poza nim
    // (regula grupy, zamknieta gielda). Ekran ma pokazac STAN FAKTYCZNY -
    // inaczej ktos bedzie przekonany, ze jest widoczny dla kontrahentow,
    // i bedzie czekal na zaproszenia, ktore nie maja skad przyjsc.
    rpc().setData("event_meeting_directory_visibility_set", {
      registration_id: ZAPIS,
      listed: false,
    });

    await expect(
      api.setMeetingDirectoryVisibility({ eventSlug: SLUG, listed: true }),
    ).resolves.toBe(false);
  });

  it("nieczytelna odpowiedź degraduje do `niewidoczny`, a nie do `widoczny`", async () => {
    // Jedyny dopuszczalny kierunek degradacji: brak potwierdzenia nie moze
    // narysowac czlowiekowi obecnosci w katalogu, ktorej nikt nie potwierdzil.
    rpc().setData("event_meeting_directory_visibility_set", null);
    await expect(
      api.setMeetingDirectoryVisibility({ eventSlug: SLUG, listed: true }),
    ).resolves.toBe(false);

    rpc().setData("event_meeting_directory_visibility_set", [{ listed: true }]);
    await expect(
      api.setMeetingDirectoryVisibility({ eventSlug: SLUG, listed: true }),
    ).resolves.toBe(false);
  });

  it("odmowa bazy leci wyjątkiem, nie cichym `false`", async () => {
    rpc().setError(
      "event_meeting_directory_visibility_set",
      "requester_not_participating: you are not registered for this event",
    );

    // Ciche `false` narysowaloby „jestes ukryty" przy zapisie, ktory sie NIE
    // odbyl - a uczestnik, ktory wlasnie prosil o ukrycie, zostalby widoczny.
    await expect(
      api.setMeetingDirectoryVisibility({ eventSlug: SLUG, listed: false }),
    ).rejects.toThrow(/^requester_not_participating:/);
  });
});
