// Powierzchnia UI sygnału Global Privacy Control - JEDEN moduł ładowany LENIWIE.
//
// DLACZEGO LENIWIE. `ConsentBanner` jest montowany z `__root`, a `ConsentsPanel`
// wisi pod dzwonkiem powiadomień - oba lądują w chunku wejściowym, który jest
// najbliżej twardego budżetu (`scripts/check-bundle-size.ts`). Nota GPC i jej
// treści PL/EN są potrzebne WYŁĄCZNIE osobom realnie wysyłającym sygnał
// (pojedyncze procenty ruchu), więc każdy kilobajt tej powierzchni w krytycznej
// ścieżce płaciliby wszyscy pozostali. Sama LOGIKA klamry (`lib/consent/gpc.ts`
// + `gpcClient.ts`) zostaje synchroniczna i eager - bramkowanie skryptów nie może
// czekać na chunk.
//
// Efekt: klamra działa od pierwszego renderu, a wyjaśnienie doczytuje się w tle.
// Prywatnościowo to właściwa kolejność - nigdy odwrotna.
//
// Slots (`GpcSurfaceSlots.tsx`) importują TEN plik, więc notatka, oba badge'e
// i nakładka i18n dzielą jeden async chunk pobierany raz na sesję.
export { GpcBadge, type GpcBadgeProps } from "@/components/consent/atoms/GpcBadge";
export { GpcNotice, type GpcNoticeProps } from "@/components/consent/molecules/GpcNotice";
export { GpcRegistryNote } from "@/components/consent/molecules/GpcRegistryNote";
export { GpcDeclarationLink } from "@/components/consent/molecules/GpcDeclarationLink";
