// Katalog opcji menu rozmowy: okna wyciszenia i etykiety okien znikania
// wiadomości. Czysty moduł, więc: (a) `ConversationMenu` eksportuje wyłącznie
// komponent (warunek działania Fast Refresh), (b) mapowanie „sekundy -> klucz
// i18n" ma test bez renderowania menu.
//
// Wartości sekund NIE są dowolne - `MESSAGE_TTL_OPTIONS` w `receipts.ts` jest
// lustrem CHECK-a w bazie, a tutejsze etykiety muszą pokrywać dokładnie ten
// zbiór. Dlatego `ttlLabelKey` ma jawne ramiona zamiast mapy z fallbackiem
// „cokolwiek": nowa wartość TTL w migracji ma zapalić test, a nie cicho dostać
// etykietę „kwartał".
import { MESSAGE_TTL_OPTIONS, type MessageTtlSeconds } from "./receipts";

/** Okno wyciszenia oferowane w menu (sekundy; -1 = na zawsze). */
export interface MuteOption {
  readonly seconds: number;
  readonly labelKey: string;
}

export const MUTE_OPTIONS: readonly MuteOption[] = [
  { seconds: 8 * 3600, labelKey: "chat.menu.mute8h" },
  { seconds: 7 * 86400, labelKey: "chat.menu.muteWeek" },
  { seconds: -1, labelKey: "chat.menu.muteAlways" },
];

/** Klucz i18n etykiety okna znikania wiadomości (null = wyłączone). */
export function ttlLabelKey(seconds: number | null): string {
  switch (seconds) {
    case null:
      return "chat.disappearing.off";
    case 86400:
      return "chat.disappearing.day";
    case 604800:
      return "chat.disappearing.week";
    case 7776000:
      return "chat.disappearing.quarter";
    default:
      // Wartość spoza lustra CHECK-a. Nie udajemy, że ją znamy - „wyłączone"
      // jest jedyną etykietą, która nie kłamie o czasie życia wiadomości.
      return "chat.disappearing.off";
  }
}

/** Pozycje sekcji „znikanie wiadomości" w kolejności wyświetlania. */
export const TTL_MENU_OPTIONS: readonly (MessageTtlSeconds | null)[] = [
  null,
  ...MESSAGE_TTL_OPTIONS,
];
