// Uchwyt na język interfejsu dla testu trasy /admin/gifting.
//
// PO CO OSOBNY MODUŁ. Fabryka `vi.mock("react-i18next", ...)` jest hoistowana,
// więc nie widzi zmiennych z góry pliku testowego, a `vi.hoisted` nie da się
// odczytać z wnętrza fabryki, która sama importuje atrapę. Ten moduł nie
// importuje NICZEGO (patrz ostrzeżenie w `@/test/i18nStub` o cyklu fabryki
// mocka), więc fabryka może go bezpiecznie zaimportować i czytać `language.current`
// przez getter - dokładnie tak, jak realna instancja i18next zmienia `language`
// w trakcie życia aplikacji.
export const language = { current: "pl" };
