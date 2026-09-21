// Kanal PODGLADU NA ZYWO w studiu wydarzenia.
//
// PO CO KONTEKST, A NIE PROPS. Podglad stoi w RAMIE studia (jest widoczny na
// kazdej sekcji), a dane do niego wpisuje EKRAN, ktory redaktor akurat edytuje:
// informacje ogolne wnosza tytul, termin i okladke, branding wnosi kolory,
// strony i menu wnosza pozycje menu. Przekazywanie tego propsami znaczyloby, ze
// rama zna wszystkie ekrany - czyli dokladnie odwrotnie niz `Outlet`.
//
// PODGLAD POKAZUJE WERSJE ROBOCZA, NIE ZAPISANA. To jest cala jego wartosc:
// redaktor widzi skutek zmiany, zanim ja zapisze. Dlatego zrodlem jest szkic
// formularza, a nie odpowiedz z bazy - i dlatego przy pustym szkicu (sekcja,
// ktora nic nie wnosi) podglad pokazuje stan ZAPISANY, a nie pustke.
//
// WZORZEC JEST W REPO: `AdminSidebarExtras` robi to samo dla dodatkowych pozycji
// sidebara panelu - rama wystawia gniazdo, ekran je wypelnia.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { BuilderDocument } from "@/lib/builder/types";
import type { EventMenuDraftItem } from "@/lib/events/eventPagesApi";
import type { EventBrandingDraft } from "@/lib/events/eventBrandingDraft";
import { EMPTY_EVENT_BRANDING } from "@/lib/events/eventBrandingDraft";
import type { EventFormat } from "@/lib/events/eventTypes";

/**
 * Pozycja menu podgladu.
 *
 * KSZTALT MIESZKA W LIB (`eventPagesApi.EventMenuDraftItem`), bo policzyc go
 * musza DWA producenty: rama studia (stan zapisany) i ekran „Strony i menu"
 * (szkic trybu prezentacji). Alias zostaje, zeby powierzchnie podgladu nadal
 * mowily o „pozycji menu podgladu", a nie o wierszu API - ale strukturalnie
 * jest to JEDEN typ, wiec dwa mapowania nie moga sie rozjechac.
 */
export type EventPreviewMenuItem = EventMenuDraftItem;

/**
 * PODSTRONA WYBRANA DO PODGLADU.
 *
 * `document === null` znaczy „strona istnieje, ale nie ma jeszcze ani jednego
 * bloku" - to inna odpowiedz niz `selectedPage === null` („patrzymy na strone
 * glowna"), i podglad musi umiec powiedziec obie.
 */
export interface EventPreviewPage {
  /**
   * Identyfikator POZYCJI MENU (`event_pages.id`), pod ktora ta strona jest
   * przypieta - albo `null`, gdy wybrana strona w menu nie stoi.
   *
   * PO CO, ZAMIAST POROWNYWANIA ETYKIET. Etykieta jest redagowalna i NIE jest
   * unikalna: dwie podstrony moga nazywac sie tak samo, a strona wybrana poza
   * menu moze dzielic nazwe z pozycja menu. Porownanie napisow zaznaczaloby
   * wtedy zla zakladke albo dwie naraz. `null` znaczy „zadna zakladka nie jest
   * aktywna" i to jest poprawna odpowiedz dla strony nieprzypietej.
   */
  key: string | null;
  label: string;
  path: string;
  document: BuilderDocument | null;
  /**
   * Znacznik pozycji modulowej (`event_pages.module`); `null` = zwykla strona.
   *
   * PO CO: podstrona modulowa niesie tresc, ktorej NIE MA w dokumencie CMS -
   * program, prelegentow i uczestnikow sklada baza. Bez tego pola podglad
   * rysowalby sam naglowek strony, tak jak przed ta zmiana.
   */
  module: string | null;
}

export interface EventPreviewModel {
  titlePl: string;
  titleEn: string;
  slug: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  format: EventFormat;
  coverUrl: string;
  videoPlatform: string;
  videoId: string;
  locationName: string;
  addressLine: string;
  descriptionPl: string;
  descriptionEn: string;
  hashtag: string;
  languages: readonly string[];
  supportEmail: string;
  status: string;
  branding: EventBrandingDraft;
  pagesDisplayMode: "list" | "grid";
  menu: readonly EventPreviewMenuItem[];
  /** `null` = podglad strony glownej wydarzenia. */
  selectedPage: EventPreviewPage | null;
}

export const EMPTY_EVENT_PREVIEW: EventPreviewModel = {
  titlePl: "",
  titleEn: "",
  slug: "",
  startsAt: "",
  endsAt: "",
  timezone: "",
  format: "onsite",
  coverUrl: "",
  videoPlatform: "",
  videoId: "",
  locationName: "",
  addressLine: "",
  descriptionPl: "",
  descriptionEn: "",
  hashtag: "",
  languages: [],
  supportEmail: "",
  status: "draft",
  branding: EMPTY_EVENT_BRANDING,
  pagesDisplayMode: "list",
  menu: [],
  selectedPage: null,
};

interface PreviewContextValue {
  model: EventPreviewModel;
  patch: (partial: Partial<EventPreviewModel>) => void;
  /** Cofniecie pol wniesionych przez ekran, ktory znika z drzewa. */
  release: (partial: Partial<EventPreviewModel>) => void;
}

const PreviewContext = createContext<PreviewContextValue | null>(null);

export function EventStudioPreviewProvider({
  base,
  children,
}: {
  /** Stan ZAPISANY - podklad, na ktory ekrany nakladaja swoje szkice. */
  base: EventPreviewModel;
  children: ReactNode;
}) {
  const [overlay, setOverlay] = useState<Partial<EventPreviewModel>>({});

  const patch = useCallback((partial: Partial<EventPreviewModel>) => {
    setOverlay((previous) => ({ ...previous, ...partial }));
  }, []);

  // ODDANIE POL, NIE ZEROWANIE NAKLADKI. Ekran, ktory znika, zabiera WYLACZNIE
  // swoje pola - reszta nakladki nalezy do ekranow, ktore stoja dalej. Pole
  // oddane wraca do wartosci z `base`, czyli do stanu ZAPISANEGO, bo nakladka
  // przestaje o nim cokolwiek mowic.
  const release = useCallback((partial: Partial<EventPreviewModel>) => {
    setOverlay((previous) => {
      const next = { ...previous };
      for (const key of Object.keys(partial) as Array<keyof EventPreviewModel>) {
        delete next[key];
      }
      return next;
    });
  }, []);

  const model = useMemo<EventPreviewModel>(() => ({ ...base, ...overlay }), [base, overlay]);
  const value = useMemo<PreviewContextValue>(
    () => ({ model, patch, release }),
    [model, patch, release],
  );

  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

/** Model do wyrysowania. Poza studiem oddaje pustke, a nie wyjatek. */
export function useEventPreviewModel(): EventPreviewModel {
  return useContext(PreviewContext)?.model ?? EMPTY_EVENT_PREVIEW;
}

/**
 * Wpisanie szkicu ekranu do podgladu.
 *
 * POROWNANIE PO WARTOSCI, nie po referencji: szkic jest nowym obiektem przy
 * kazdym nacisnieciu klawisza, wiec zaleznosc po referencji dawalaby
 * `setState` w kazdym renderze i petle. Klucz porownania liczy sie z tresci.
 *
 * SZKIC ZNIKA RAZEM Z EKRANEM. Nakladka jest wspolna dla calego studia, wiec
 * bez sprzatania efektu tytul wpisany na „Informacjach ogolnych" i NIEZAPISANY
 * zostawalby w podgladzie takze po przejsciu na inna sekcje - czyli redaktor
 * ogladalby wartosc, ktorej nie ma ani w bazie, ani w zadnym otwartym
 * formularzu, i po odswiezeniu strony czytalby jej znikniecie jako zgubiony
 * zapis. Ta sama luka pozwalala przeterminowanej nakladce wygrywac z nowym
 * `base` z bazy.
 */
export function useSyncEventPreview(partial: Partial<EventPreviewModel>): void {
  const context = useContext(PreviewContext);
  const patch = context?.patch;
  const release = context?.release;
  const serialized = JSON.stringify(partial);

  useEffect(() => {
    if (patch === undefined || release === undefined) return;
    // Odczyt z tego samego napisu, ktory jest kluczem zaleznosci: efekt nie ma
    // wtedy zaleznosci niewidocznej dla lintera, a szkic jest zwyklymi danymi,
    // wiec obieg przez JSON niczego nie gubi.
    const draft = JSON.parse(serialized) as Partial<EventPreviewModel>;
    patch(draft);
    // Sprzatanie oddaje DOKLADNIE te pola, ktore ten ekran wniosl - takze przy
    // zmianie tresci szkicu, gdzie zaraz po nim leci `patch` z nowa wartoscia.
    return () => release(draft);
  }, [serialized, patch, release]);
}
