// ROLE SYSTEMOWE I ICH ETYKIETY (`authz/roles.ts`, `authz/roleLabels.ts`).
//
// CO TEN PLIK DOWODZI. Oba moduły są maleńkie i oba są JEDNYM ŹRÓDŁEM PRAWDY
// o rolach po stronie klienta: `APP_ROLES` wyznacza kolejność kolumn macierzy
// uprawnień, a `ROLE_LABEL_KEYS` decyduje, co administrator w ogóle przeczyta
// przy nadawaniu roli. Przed tym plikiem `roleLabels.ts` miał ZERO wykonanych
// linii, a `roles.ts` 60% - czyli ani `isAppRole`, ani `isImplicitRole`, ani
// żadna etykieta nie były sprawdzone niczym.
//
// Dowodzone są trzy rzeczy, każda o innym skutku przy błędzie:
//
//   1. DOMKNIĘCIE MAPY ETYKIET po `APP_ROLES`. Rola dodana bez etykiety jest
//      błędem kompilacji, ale kompilator nie zauważy etykiety WSKAZUJĄCEJ NA
//      NIE TEN KLUCZ (literówka w napisie). Asercja porównuje więc zbiory:
//      klucze mapy = zbiór ról, a każdy klucz tłumaczenia kończy się dokładnie
//      identyfikatorem swojej roli.
//   2. STATYCZNOŚĆ kluczy tłumaczeń. Komentarz w produkcji opisuje incydent:
//      oba ekrany użytkowników sklejały klucz z identyfikatora roli
//      (`admin.users.roles.${r}`), takiego klucza nie było w żadnym słowniku,
//      więc renderował się angielski `defaultValue` - także w polskim
//      interfejsie - a bramka parytetu tłumaczeń nie miała czego zobaczyć.
//      Tutaj pilnujemy, że klucze są literałami z mapy, nie sklejeniem.
//   3. ROLA NIEJAWNA. `user` nie ma wiersza w `user_roles` (to stan
//      „zalogowany bez roli redakcyjnej”), więc macierz uprawnień musi
//      traktować tę kolumnę inaczej niż pozostałe. Pomyłka w tym predykacie
//      pokazywałaby w audycie uprawnienia, których żadna bramka nie nadaje.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Parytetu z enumem `public.app_role` odtworzonym
// z migracji - to `src/lib/authz/__tests__/authzSnapshotParity.test.ts`
// i bramki `check:authz-snapshot` / `check:permissions-parity`. Obecności
// kluczy w słownikach PL/EN - to bramki `check:i18n-*`. Reguł nadawania roli
// w bazie - to pgTAP (`role_management_test.sql`).
import { describe, expect, it } from "vitest";
// PRAWDZIWY tłumacz, nie atrapa - patrz `src/test/i18nReal.ts`. Atrapa oddająca
// klucz dowiodłaby tylko tego, że `roleLabel` woła `t`; realna instancja
// dowodzi, że klucz JEST w słowniku, i to w obu językach. Import nakładki
// rejestruje jej zasoby efektem ubocznym (tak samo, jak robi to komponent).
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-admin-users";
import {
  APP_ROLES,
  IMPLICIT_ROLES,
  isAppRole,
  isImplicitRole,
  type AppRole,
} from "@/lib/authz/roles";
import { ROLE_LABEL_KEYS, roleLabel } from "@/lib/authz/roleLabels";

describe("APP_ROLES - jedno źródło prawdy o rolach", () => {
  it("lista ról jest UPORZĄDKOWANA malejącym zakresem przywilejów", () => {
    // Kolejność nie jest kosmetyką: to jednocześnie kolejność kolumn macierzy
    // uprawnień. Przestawienie dwóch pozycji przesuwa cały audyt o jedną
    // kolumnę i nikt tego nie zauważy, bo nagłówki dalej się renderują.
    expect([...APP_ROLES]).toEqual(["super_admin", "admin", "editor", "author", "user"]);
  });

  it("lista nie ma powtórzeń - inaczej macierz dublowałaby kolumnę", () => {
    expect(new Set(APP_ROLES).size).toBe(APP_ROLES.length);
  });

  it.each(APP_ROLES)("`isAppRole` rozpoznaje rolę „%s”", (role) => {
    expect(isAppRole(role)).toBe(true);
  });

  it.each([
    { label: "rola z literówką", value: "supper_admin" },
    { label: "rola z innej dziedziny", value: "moderator" },
    { label: "pusty napis", value: "" },
    { label: "inna wielkość liter", value: "Admin" },
    { label: "rola z białymi znakami", value: " admin " },
    { label: "napis z bazy z prefiksem schematu", value: "public.admin" },
  ])("`isAppRole` ODRZUCA $label", ({ value }) => {
    // Predykat jest bramką typu: przepuszczona wartość jedzie dalej jako
    // `AppRole` i trafia do zapytania nadania roli. „Prawie" nie wystarczy.
    expect(isAppRole(value)).toBe(false);
  });

  it("rola NIEJAWNA to dokładnie `user` - i tylko ona", () => {
    // `user` nie ma wiersza w `user_roles`, więc kolumna macierzy pokazuje
    // wyłącznie to, co daje warstwa członkostwa. Gdyby predykat objął też
    // `author`, audyt pokazałby jego uprawnienia jako „z członkostwa”.
    expect([...IMPLICIT_ROLES]).toEqual(["user"]);
    const implicit = APP_ROLES.filter((role) => isImplicitRole(role));
    expect(implicit).toEqual(["user"]);
  });

  it.each(APP_ROLES.filter((role) => role !== "user"))(
    "rola „%s” NIE jest niejawna - ma własny wiersz w `user_roles`",
    (role) => {
      expect(isImplicitRole(role)).toBe(false);
    },
  );
});

describe("ROLE_LABEL_KEYS - etykiety ról w interfejsie", () => {
  it("mapa jest DOMKNIĘTA po `APP_ROLES` - ani mniej, ani więcej", () => {
    // Kompilator pilnuje braku klucza, ale nie pilnuje NADMIARU: etykieta roli
    // usuniętej z systemu zostawałaby w mapie i myliła następnego czytelnika.
    expect(Object.keys(ROLE_LABEL_KEYS).sort()).toEqual([...APP_ROLES].sort());
  });

  it.each(APP_ROLES)("klucz etykiety roli „%s” wskazuje na WŁASNĄ rolę", (role) => {
    // To jest asercja o LITERÓWCE, której typ nie widzi: `admin: "…roles.adnim"`
    // kompiluje się bez zastrzeżeń, a w panelu daje surowy klucz na ekranie.
    expect(ROLE_LABEL_KEYS[role]).toBe(`admin.users.roles.${role}`);
  });

  it("wszystkie klucze są RÓŻNE - dwie role nie mogą dzielić etykiety", () => {
    const keys = Object.values(ROLE_LABEL_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each([
    { role: "super_admin", pl: "Super admin", en: "Super admin" },
    { role: "admin", pl: "Administrator", en: "Admin" },
    { role: "editor", pl: "Redaktor", en: "Editor" },
    { role: "author", pl: "Autor", en: "Author" },
    { role: "user", pl: "Użytkownik", en: "User" },
  ] as const)("`roleLabel` oddaje TŁUMACZENIE roli „$role” w obu językach", ({ role, pl, en }) => {
    // Sedno incydentu opisanego w nagłówku modułu produkcyjnego: wcześniej na
    // ekranie kończył się angielski identyfikator z wielkiej litery, także po
    // polsku. Asercja jest na PRAWDZIWYM słowniku, więc usunięcie klucza
    // z nakładki oblewa ten test - czego atrapa oddająca klucz nie zobaczy.
    expect(roleLabel(realT("pl"), role)).toBe(pl);
    expect(roleLabel(realT("en"), role)).toBe(en);
  });

  it.each(APP_ROLES)("etykieta roli „%s” NIE jest surowym kluczem ani identyfikatorem", (role) => {
    // i18next oddaje klucz, gdy tłumaczenia nie ma - i to jest dokładnie stan
    // sprzed powstania nakładki. Ta asercja jest bramką na jego powrót.
    const label = roleLabel(realT("pl"), role);
    expect(label).not.toBe(ROLE_LABEL_KEYS[role]);
    expect(label).not.toBe(role);
    expect(label).not.toBe(role.charAt(0).toUpperCase() + role.slice(1));
  });

  it("polska etykieta administratora RÓŻNI SIĘ od angielskiej", () => {
    // Kontrola dodatnia dwujęzyczności: `Super admin` jest w obu językach taki
    // sam (nazwa własna), więc gdyby test opierał się tylko na nim, słownik
    // angielski mógłby w ogóle nie istnieć i nikt by nie zauważył.
    const role: AppRole = "admin";
    expect(roleLabel(realT("pl"), role)).not.toBe(roleLabel(realT("en"), role));
  });
});
