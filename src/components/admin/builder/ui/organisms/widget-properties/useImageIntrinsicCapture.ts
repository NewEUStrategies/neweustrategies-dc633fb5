// Pomiar i zapis naturalnego rozmiaru plików widgetu obrazu
// (`srcIntrinsic` / `srcDarkIntrinsic`, napis "WxH").
//
// WYŁĄCZNIE KOD PANELU. To wartość MIERZONA, nie wpisywana: renderer dokłada z
// niej obrazowi bez ramki atrybuty `width`/`height` (Lighthouse
// `unsized-images`). Hak mierzy plik i zapisuje wynik:
//   - przy ZMIANIE pliku (`changeSlot`): stary rozmiar jest zerowany w tym samym
//     kroku cofania co nowy adres, a nowy plik mierzony;
//   - raz po ZAZNACZENIU widgetu (istniejąca treść sprzed tej funkcji), o ile
//     to nie instancja widgetu globalnego i TYLKO dla slotu, którego rozmiaru
//     publiczny renderer użyje (`intrinsicSlotUse`): obraz w ramce i widget,
//     którego własny plik zastępuje logo motywu, nie są ani mierzone, ani
//     zapisywane. Samo kliknięcie nie może dokładać kroku "cofnij" bez
//     widocznego skutku ani uruchamiać autozapisu dla wartości, którą render
//     odrzuca;
//   - gdy redaktor PRZEŁĄCZY ustawienie tak, że renderer zacznie rozmiaru
//     używać (`setRenderOption`: "Proporcje" na auto, wyłączone "Użyj logo
//     witryny") - efekt po zaznaczeniu nie uruchomi się drugi raz dla tego
//     samego widgetu. Zmianę samego altu (słowo "logo") dogania dopiero kolejne
//     zaznaczenie.
// Pomiar NIGDY nie jest efektem zależnym od adresu ani od zapisanej wartości:
// cofnięcie przywraca starszy adres albo pusty rozmiar, efekt zapisałby wtedy
// ponownie, a każdy zapis czyści stos "ponów".
//
// PLIK BEZ WŁASNEJ PROPORCJI (werdykt `noRatio` pomiaru, np. SVG bez `viewBox`)
// ZERUJE rozmiar zapisany dla slotu: to rozmiar zastępczy przeglądarki albo
// rozmiar pliku, który stał pod tym adresem wcześniej, i jego atrybuty zmieniają
// kształt obrazu na stałe. Zerowanie idzie tymi samymi ścieżkami co zapis
// rozmiaru i pod tymi samymi warunkami - zaznaczenie nie pisze do slotu,
// którego renderer nie użyje. Pomiar NIEUDANY (plik niedostępny, limit czasu)
// niczego nie zmienia.
//
// KTO TRZYMA HAK. Panel właściwości (`WidgetProperties`), NAD zakładkami: żyje
// przez całe zaznaczenie widgetu, bez względu na to, która zakładka jest
// otwarta. Edytor obrazu mieszka w zakładce "Treść", a zakładka nieaktywna nie
// jest montowana - hak trzymany przez edytor gubił wynik pomiaru, gdy redaktor
// przeszedł na "Styl" albo "Zaawansowane", i nie mierzył zaznaczonego obrazu,
// dopóki "Treść" nie była otwarta (aktywna zakładka przeżywa zmianę
// zaznaczenia). Zapis idzie nadal przez `setContent` zaznaczonego widgetu,
// czyli przez jego własny `onChange` - nic nie trafia do historii buildera poza
// zaznaczonym widgetem. Edytor renderowany bez panelu (testy edytora, bramka
// wierności ustawień) nie dostaje haka z góry i prowadzi pomiar sam, tym samym
// kodem.
//
// ZNANE OGRANICZENIE. Wynik pomiaru zapisuje panel ZAZNACZONEGO widgetu. Gdy
// redaktor odznaczy widget albo zaznaczy inny, zanim pomiar nowego pliku wróci
// (okno to czas pobrania obrazu), wynik przepada i treść zostaje z nowym
// adresem i pustym rozmiarem - strona renderuje wtedy znacznik bez atrybutów,
// dokładnie jak przed tą funkcją. Wyniku nie dopisujemy po fakcie do widgetu,
// którego redaktor już nie edytuje: taki zapis szedłby przez historię buildera
// poza jego działaniem (osobny krok "cofnij" bez widocznego skutku, wyczyszczony
// stos "ponów", przerwana seria edycji innego widgetu). Stan naprawia kolejne
// zaznaczenie widgetu (pomiar rusza od nowa, bo rozmiaru brak), a do tego czasu
// podpowiedź pod slotem mówi, że wymiary nie są zapisane. Instancji widgetu
// globalnego zaznaczenie nie mierzy, więc tam rozmiar wraca dopiero przy
// kolejnej zmianie pliku albo ustawienia - podpowiedź pokazuje to tak samo.
// Przejście na inną zakładkę panelu wyniku NIE gubi.
import { useCallback, useContext, useEffect, useRef } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import type { WidgetNode, Json } from "@/lib/builder/types";
import {
  IMAGE_FILE_SLOTS,
  intrinsicSlotUse,
  type ImageFileSlot,
  type SiteLogoSettings,
} from "@/lib/admin/imageIntrinsicUse";
import { measureIntrinsicSize } from "@/lib/media/measureIntrinsicSize";
import { resolveSetting, siteSettingsQueryOptions, type SettingsMap } from "@/lib/useSiteSetting";

/** Klucz treści z naturalnym rozmiarem pliku slotu. */
const INTRINSIC_KEY = { src: "srcIntrinsic", srcDark: "srcDarkIntrinsic" } as const;

/** Zapisy edytora obrazu, które idą przez pomiar. */
export interface ImageIntrinsicCapture {
  /** Zmiana pliku slotu: nowy adres, wyzerowany stary rozmiar, pomiar nowego. */
  changeSlot: (slot: ImageFileSlot, value: string) => void;
  /**
   * Zapis ustawienia, od którego zależy, czy renderer użyje rozmiaru własnego
   * pliku ("Użyj logo witryny", "Proporcje"). Gdy zmiana WŁĄCZA użycie slotu
   * (zdjęta ramka, wyłączone logo witryny), jego plik jest mierzony od razu.
   * To edycja redaktora, nie zaznaczenie, więc dotyczy też instancji widgetu
   * globalnego - rozmiar wpada w ten sam krok cofania co zmiana ustawienia.
   */
  setRenderOption: (key: string, value: Json) => void;
}

interface Options {
  /**
   * `false` wyłącza hak w całości (żadnego pomiaru ani zapisu): widget innego
   * typu w panelu albo edytor, któremu zapisy podał panel.
   */
  enabled: boolean;
  c: WidgetNode["content"];
  setContent: (k: string, v: Json) => void;
  /**
   * Identyfikator edytowanego widgetu: zmiana = zaznaczono inny obraz, więc
   * jego pliki są mierzone raz. Bez identyfikatora pomiar biegnie tylko przy
   * montażu.
   */
  widgetId?: string;
  /**
   * Instancja widgetu globalnego: samo zaznaczenie nie może niczego zapisać -
   * zapis instancji wypycha jej (być może nieaktualną) migawkę do wspólnego
   * rekordu. Rozmiar jest wtedy mierzony dopiero przy realnej edycji: zmianie
   * pliku albo ustawienia, które włącza użycie rozmiaru (`setRenderOption`).
   */
  isGlobal?: boolean;
}

/**
 * Stan BIEŻĄCY dla kodu, który działa poza renderem (wynik pomiaru, obsługa
 * zdarzeń): treść z propsa plus `pending` - zapisy już wysłane, których rodzic
 * nie oddał jeszcze propsem. Każdy render zaczyna od pustego `pending`.
 */
interface Latest {
  c: WidgetNode["content"];
  pending: Map<string, Json>;
  setContent: (k: string, v: Json) => void;
}

const readLatest = (now: Latest, key: string): unknown =>
  now.pending.has(key) ? now.pending.get(key) : now.c[key];
const readText = (now: Latest, key: string): string => {
  const value = readLatest(now, key);
  return typeof value === "string" ? value : "";
};

export function useImageIntrinsicCapture({
  enabled,
  c,
  setContent,
  widgetId,
  isGlobal = false,
}: Options): ImageIntrinsicCapture {
  // Logo motywu z TEGO SAMEGO cache'u ustawień, z którego rysuje podgląd na
  // kanwie (bez własnego pobrania i bez subskrypcji - czytane dopiero w chwili
  // zdarzenia): od niego zależy, czy renderer narysuje własny plik widgetu,
  // czyli czy jego rozmiar jest do czegokolwiek potrzebny. Kontekst czytany
  // wprost, bo `useQueryClient` rzuca bez dostawcy, a hak stoi w panelu także
  // przy widgetach, które nie są obrazami.
  const queryClient = useContext(QueryClientContext);

  // Stan BIEŻĄCY dla wyników pomiaru, które wracają asynchronicznie: wynik
  // wolno zapisać tylko wtedy, gdy slot nadal wskazuje zmierzony plik.
  const latest = useRef<Latest>({ c, pending: new Map(), setContent });
  useEffect(() => {
    latest.current = { c, pending: new Map(), setContent };
  });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Które sloty renderer zasili rozmiarem z treści - przy bieżącym stanie. */
  const slotUse = useCallback(
    (now: Latest) =>
      intrinsicSlotUse(
        (key) => readLatest(now, key),
        resolveSetting<{ logo?: SiteLogoSettings }>(
          queryClient?.getQueryData<SettingsMap>(siteSettingsQueryOptions.queryKey),
          "theme_options",
          {},
        ).logo,
      ),
    [queryClient],
  );

  /**
   * Mierzy plik slotu i zapisuje rozmiar, jeśli różni się od zapisanego. Plik
   * bez własnej proporcji (`noRatio`) zapisuje rozmiar PUSTY, czyli zeruje
   * wartość zapisaną wcześniej; pomiar nieudany niczego nie zapisuje.
   * `onlyIfUsed`: pomiar wywołany zaznaczeniem albo przełączeniem ustawienia -
   * wynik przepada, gdy renderer w międzyczasie przestał rozmiaru używać.
   */
  const capture = useCallback(
    (slot: ImageFileSlot, url: string, onlyIfUsed = false) => {
      if (!url) return;
      void measureIntrinsicSize(url).then(({ size, noRatio }) => {
        const now = latest.current;
        const key = INTRINSIC_KEY[slot];
        if (
          !alive.current ||
          !(size || noRatio) ||
          readText(now, slot) !== url ||
          readText(now, key) === size
        ) {
          return;
        }
        if (onlyIfUsed && !slotUse(now)[slot]) return;
        now.pending.set(key, size);
        now.setContent(key, size);
      });
    },
    [slotUse],
  );

  const changeSlot = useCallback(
    (slot: ImageFileSlot, value: string) => {
      const now = latest.current;
      const key = INTRINSIC_KEY[slot];
      now.setContent(slot, value);
      // Ten sam krok cofania co adres (zapisy jednego widgetu się zwijają), więc
      // "cofnij" przywraca stary plik RAZEM z jego rozmiarem.
      if (readText(now, key)) now.setContent(key, "");
      now.pending.set(slot, value);
      now.pending.set(key, "");
      capture(slot, value);
    },
    [capture],
  );

  const setRenderOption = useCallback(
    (k: string, v: Json) => {
      const now = latest.current;
      const before = slotUse(now);
      now.setContent(k, v);
      now.pending.set(k, v);
      const after = slotUse(now);
      for (const slot of IMAGE_FILE_SLOTS) {
        if (!before[slot] && after[slot]) capture(slot, readText(now, slot), true);
      }
    },
    [capture, slotUse],
  );

  // Treść sprzed tej funkcji (i wklejona poza edytorem) nie ma rozmiaru - mierzymy
  // ją raz, gdy redaktor zaznaczy widget, ale tylko tam, gdzie renderer rozmiaru
  // użyje. Zależność to WYŁĄCZNIE tożsamość widgetu, nigdy adres ani zapisana
  // wartość (patrz nagłówek pliku).
  useEffect(() => {
    if (!enabled || isGlobal) return;
    const now = latest.current;
    const used = slotUse(now);
    for (const slot of IMAGE_FILE_SLOTS) {
      if (used[slot]) capture(slot, readText(now, slot), true);
    }
  }, [enabled, widgetId, isGlobal, capture, slotUse]);

  return { changeSlot, setRenderOption };
}
