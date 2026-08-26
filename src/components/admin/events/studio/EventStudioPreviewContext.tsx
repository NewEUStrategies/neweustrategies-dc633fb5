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
import type { EventBrandingDraft } from "@/lib/events/eventBrandingDraft";
import { EMPTY_EVENT_BRANDING } from "@/lib/events/eventBrandingDraft";
import type { EventFormat } from "@/lib/events/eventTypes";

export interface EventPreviewMenuItem {
  key: string;
  label: string;
  icon: string;
  color: string;
}

/**
 * PODSTRONA WYBRANA DO PODGLADU.
 *
 * `document === null` znaczy „strona istnieje, ale nie ma jeszcze ani jednego
 * bloku" - to inna odpowiedz niz `selectedPage === null` („patrzymy na strone
 * glowna"), i podglad musi umiec powiedziec obie.
 */
export interface EventPreviewPage {
  label: string;
  path: string;
  document: BuilderDocument | null;
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

  const model = useMemo<EventPreviewModel>(() => ({ ...base, ...overlay }), [base, overlay]);
  const value = useMemo<PreviewContextValue>(() => ({ model, patch }), [model, patch]);

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
 */
export function useSyncEventPreview(partial: Partial<EventPreviewModel>): void {
  const context = useContext(PreviewContext);
  const patch = context?.patch;
  const serialized = JSON.stringify(partial);

  useEffect(() => {
    if (patch === undefined) return;
    // Odczyt z tego samego napisu, ktory jest kluczem zaleznosci: efekt nie ma
    // wtedy zaleznosci niewidocznej dla lintera, a szkic jest zwyklymi danymi,
    // wiec obieg przez JSON niczego nie gubi.
    patch(JSON.parse(serialized) as Partial<EventPreviewModel>);
  }, [serialized, patch]);
}
