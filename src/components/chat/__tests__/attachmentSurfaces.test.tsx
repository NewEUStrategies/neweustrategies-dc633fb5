// Powierzchnie RENDERUJĄCE załączniki czatu: `AttachmentContent.tsx`
// (12,5% linii, 4,8% gałęzi, 1/13 funkcji) i `AttachmentPreview.tsx`
// (38,1% linii, 5/29 funkcji). Przez te dwa pliki przechodzi KAŻDY plik, jaki
// użytkownik przyśle w czacie, a jedyne, co je dotąd sprawdzało, to render
// dymka z atrapą atomu.
//
// PODZIAŁ DOWODÓW. Czyste reguły prezentacji - macierz MIME -> rodzina ikony,
// arytmetyka zoomu z `toFixed(2)`, obrót, przycinanie i zawijanie indeksu
// galerii, mapa skrótów klawiszowych - mają własny plik
// `src/lib/chat/__tests__/attachmentPresentation.test.ts` i NIE są tu
// powtarzane. TUTAJ dowodzimy SKLEJENIA tych reguł z DOM-em, czyli tego,
// czego czysta funkcja nie pokaże:
//   - że stan „podpisany URL jeszcze nie wrócił" nie kończy się złamanym
//     obrazkiem ani martwym przyciskiem pobierania,
//   - że odtwarzacz notatki głosowej faktycznie zmienia etykietę i pasek
//     postępu pod zdarzeniami elementu <audio> (a przy odmontowaniu pauzuje,
//     bo oderwany <audio> potrafi grać dalej),
//   - że przycisk „Podgląd" istnieje WYŁĄCZNIE dla PDF-a,
//   - że pełnoekranowy podgląd wyłącza akcje, których nie da się wykonać
//     (pomniejszenie na 100%, powiększenie na suficie), a strzałki i licznik
//     pojawiają się dopiero przy galerii większej niż jedno zdjęcie,
//   - że skróty klawiszowe działają tylko przy OTWARTYM podglądzie.
//
// POZA ZAKRESEM (świadomie): przeciąganie obrazu i zoom kółkiem myszy -
// wymagają geometrii oraz `setPointerCapture`, których happy-dom nie liczy;
// sama decyzja „czy kółko zmienia zoom" jest pokryta czysto.
//
// RODO: żadnych prawdziwych osób ani plików - ścieżki składane z `CHAT_IDS`,
// nazwy plików i adresy zmyślone (domena `example.org`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { CHAT_IDS } from "@/test/chat/fixtures";
import { formatVoiceDuration } from "@/lib/chat/voice";
import {
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_MIN_ZOOM,
  LIGHTBOX_ZOOM_STEP,
} from "@/lib/chat/attachmentPresentation";

const h = vi.hoisted(() => ({
  url: { data: undefined as string | undefined, isLoading: false },
  requestedPaths: [] as Array<string | null>,
}));

// Częściowa atrapa: `formatBytes` zostaje PRAWDZIWY (to on decyduje o tym, co
// widzi użytkownik pod nazwą pliku i ma własne testy). Podmieniamy wyłącznie
// `useAttachmentUrl`, bo podpisany URL przychodzi z react-query + Storage,
// a tu testujemy render, nie podpisywanie.
vi.mock("@/lib/chat/attachments", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/chat/attachments")>();
  return {
    ...real,
    useAttachmentUrl: (path: string | null) => {
      h.requestedPaths.push(path);
      return { data: h.url.data, isLoading: h.url.isLoading };
    },
  };
});

import { formatBytes } from "@/lib/chat/attachments";
import { AttachmentAudio, AttachmentFile, AttachmentImage } from "../AttachmentContent";
import {
  ImageLightbox,
  PdfPreviewDialog,
  type ImageLightboxProps,
  type PdfPreviewDialogProps,
} from "../AttachmentPreview";

const t = chatPl.chat;

const IMAGE_PATH = `${CHAT_IDS.tenant}/${CHAT_IDS.conversation}/${CHAT_IDS.me}/zdjecie.png`;
const AUDIO_PATH = `${CHAT_IDS.tenant}/${CHAT_IDS.conversation}/${CHAT_IDS.me}/notatka.webm`;
const FILE_PATH = `${CHAT_IDS.tenant}/${CHAT_IDS.conversation}/${CHAT_IDS.me}/raport.pdf`;

const PHOTO_URL = "https://storage.example.org/podpisane/zdjecie.png";
const AUDIO_URL = "https://storage.example.org/podpisane/notatka.webm";
// PDF celowo jako `data:`, a NIE `https:` - podgląd montuje prawdziwy <iframe>,
// a happy-dom próbuje taki adres realnie pobrać (test wychodziłby do sieci).
// `data:` rozwiązuje się lokalnie, a `useAttachmentUrl` i tak przepuszcza ten
// schemat bez zmian (ścieżka podglądów lokalnych, np. bota demo).
const PDF_URL = "data:application/pdf;base64,JVBERi0xLjQK";

/** i18next podstawia `{{...}}`; test nie może wpisywać przetłumaczonego literału. */
function fill(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match: string, key: string) => String(vars[key]));
}

// happy-dom (tak samo jak jsdom) NIE implementuje odtwarzania mediów: bez tych
// atrap `el.play()` wysadza test, a `el.pause()` nie daje się zaobserwować.
const mediaPlay = vi.fn();
const mediaPause = vi.fn();

beforeEach(() => {
  Object.defineProperty(HTMLMediaElement.prototype, "play", {
    value: mediaPlay,
    configurable: true,
  });
  Object.defineProperty(HTMLMediaElement.prototype, "pause", {
    value: mediaPause,
    configurable: true,
  });
  mediaPlay.mockClear();
  mediaPause.mockClear();
  h.url.data = undefined;
  h.url.isLoading = false;
  h.requestedPaths = [];
});

afterEach(() => cleanup());

function audioElement(container: HTMLElement): HTMLAudioElement {
  const el = container.querySelector("audio");
  if (!el) throw new Error("test: odtwarzacz nie wyrenderował elementu <audio>");
  return el;
}

/** Klasy ikony lucide jako tokeny - `lucide-file` NIE jest `lucide-file-text`. */
function iconTokens(container: HTMLElement): string[] {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("test: chip pliku nie renderuje ikony");
  return (svg.getAttribute("class") ?? "").split(/\s+/).filter((token) => token.length > 0);
}

describe("AttachmentImage - zdjęcie w dymku", () => {
  it("przed podpisaniem URL-a pokazuje szkielet opisany dla czytnika ekranu, a nie pusty obrazek", () => {
    h.url.isLoading = true;
    const { container } = render(
      <AttachmentImage path={IMAGE_PATH} name="wykres.png" mine={false} />,
    );

    expect(screen.getByLabelText(t.photo)).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
    expect(h.requestedPaths).toContain(IMAGE_PATH);
  });

  it("gdy podpisania NIE da się wykonać, użytkownik dostaje komunikat, a nie złamany link", () => {
    render(<AttachmentImage path={IMAGE_PATH} name="wykres.png" mine={false} />);

    expect(screen.getByText(t.uploadFailed)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("miniatura niesie nazwę pliku jako tekst alternatywny", () => {
    h.url.data = PHOTO_URL;
    render(<AttachmentImage path={IMAGE_PATH} name="wykres.png" mine={true} />);

    const img = screen.getByRole("img", { name: "wykres.png" });
    expect(img.getAttribute("src")).toBe(PHOTO_URL);
    expect(screen.getByRole("button", { name: "wykres.png" })).toBeTruthy();
  });

  it("załącznik bez nazwy nie zostaje bez opisu - wchodzi rzeczownik „Zdjęcie”", () => {
    h.url.data = PHOTO_URL;
    render(<AttachmentImage path={IMAGE_PATH} name={null} mine={false} />);

    expect(screen.getByRole("img", { name: t.photo })).toBeTruthy();
  });

  it("kliknięcie miniatury otwiera pełnoekranowy podgląd", () => {
    h.url.data = PHOTO_URL;
    render(<AttachmentImage path={IMAGE_PATH} name="wykres.png" mine={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "wykres.png" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(screen.getByRole("button", { name: t.preview.close })).toBeTruthy();
    // Pojedyncze zdjęcie to nie galeria - żadnych strzałek ani licznika.
    expect(screen.queryByRole("button", { name: t.preview.next })).toBeNull();
  });
});

describe("AttachmentAudio - notatka głosowa", () => {
  it("bez podpisanego URL-a przycisk odtwarzania jest WYŁĄCZONY i nie ma czego odtwarzać", () => {
    const { container } = render(<AttachmentAudio path={AUDIO_PATH} duration={30} mine={false} />);

    expect(screen.getByRole("button", { name: t.voice.play })).toBeDisabled();
    expect(container.querySelector("audio")).toBeNull();
  });

  it("gotowy odtwarzacz startuje na zerze i pokazuje długość nagrania", () => {
    h.url.data = AUDIO_URL;
    const { container } = render(<AttachmentAudio path={AUDIO_PATH} duration={65} mine={false} />);

    expect(screen.getByRole("button", { name: t.voice.play })).not.toBeDisabled();
    expect(audioElement(container).getAttribute("src")).toBe(AUDIO_URL);

    const bar = screen.getByRole("progressbar", { name: t.voice.message });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText(formatVoiceDuration(65))).toBeTruthy();
  });

  it("przycisk odtwarza, a po zdarzeniu `play` zmienia się we WSTRZYMANIE i pauzuje", () => {
    h.url.data = AUDIO_URL;
    const { container } = render(<AttachmentAudio path={AUDIO_PATH} duration={65} mine={false} />);
    const audio = audioElement(container);

    fireEvent.click(screen.getByRole("button", { name: t.voice.play }));
    expect(mediaPlay).toHaveBeenCalledTimes(1);

    // Przeglądarka potwierdza start dopiero zdarzeniem - dopiero ono przestawia UI.
    fireEvent.play(audio);
    expect(screen.queryByRole("button", { name: t.voice.play })).toBeNull();
    expect(screen.getByText(formatVoiceDuration(0))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t.voice.pause }));
    expect(mediaPause).toHaveBeenCalledTimes(1);

    fireEvent.pause(audio);
    expect(screen.getByRole("button", { name: t.voice.play })).toBeTruthy();
  });

  it("postęp odtwarzania jedzie z elementu, nie z zegara komponentu", () => {
    h.url.data = AUDIO_URL;
    const { container } = render(<AttachmentAudio path={AUDIO_PATH} duration={60} mine={false} />);
    const audio = audioElement(container);
    Object.defineProperty(audio, "currentTime", { value: 30, configurable: true });

    fireEvent.timeUpdate(audio);

    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText(formatVoiceDuration(30))).toBeTruthy();
  });

  it("koniec nagrania cofa pasek i licznik do stanu wyjściowego", () => {
    h.url.data = AUDIO_URL;
    const { container } = render(<AttachmentAudio path={AUDIO_PATH} duration={60} mine={false} />);
    const audio = audioElement(container);
    Object.defineProperty(audio, "currentTime", { value: 45, configurable: true });

    fireEvent.play(audio);
    fireEvent.timeUpdate(audio);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("75");

    fireEvent.ended(audio);

    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByRole("button", { name: t.voice.play })).toBeTruthy();
    expect(screen.getByText(formatVoiceDuration(60))).toBeTruthy();
  });

  it("ODMONTOWANIE pauzuje nagranie - oderwany <audio> potrafi grać dalej", () => {
    h.url.data = AUDIO_URL;
    const { container, unmount } = render(
      <AttachmentAudio path={AUDIO_PATH} duration={60} mine={false} />,
    );
    fireEvent.play(audioElement(container));
    expect(mediaPause).not.toHaveBeenCalled();

    unmount();

    expect(mediaPause).toHaveBeenCalledTimes(1);
  });
});

describe("AttachmentFile - chip pliku", () => {
  it("arkusz dostaje ikonę arkusza (CSV liczy się jako arkusz, nie dokument)", () => {
    const { container } = render(
      <AttachmentFile
        path={FILE_PATH}
        name="zestawienie.csv"
        mime="text/csv"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(iconTokens(container)).toContain("lucide-file-spreadsheet");
  });

  it("prezentacja dostaje ikonę prezentacji", () => {
    const { container } = render(
      <AttachmentFile
        path={FILE_PATH}
        name="agenda.pptx"
        mime="application/vnd.ms-powerpoint"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(iconTokens(container)).toContain("lucide-presentation");
  });

  it("dokument dostaje ikonę dokumentu", () => {
    const { container } = render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(iconTokens(container)).toContain("lucide-file-text");
  });

  it("załącznik bez typu MIME dostaje ikonę ogólną i nazwę zastępczą", () => {
    const { container } = render(
      <AttachmentFile
        path={FILE_PATH}
        name={null}
        mime={null}
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(iconTokens(container)).toContain("lucide-file");
    expect(iconTokens(container)).not.toContain("lucide-file-text");
    expect(screen.getByText(t.file)).toBeTruthy();
  });

  it("rozmiar pokazuje się w formacie języka rozmowy", () => {
    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(screen.getByText(formatBytes(2048, "pl"))).toBeTruthy();
  });

  it("zerowy rozmiar NIE pokazuje „0 B” - to szum, nie informacja", () => {
    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={0}
        mine={false}
        lang="pl"
      />,
    );
    expect(screen.queryByText(formatBytes(0, "pl"))).toBeNull();
  });

  it("nieznany rozmiar (null) też nie dorabia liczby", () => {
    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={null}
        mine={false}
        lang="pl"
      />,
    );
    expect(screen.queryByText(/\d+(,\d+)?\s(B|KB|MB|GB)/)).toBeNull();
  });

  it("przycisk podglądu istnieje WYŁĄCZNIE dla PDF-a", () => {
    h.url.data = PDF_URL;
    const { unmount } = render(
      <AttachmentFile
        path={FILE_PATH}
        name="notatka.txt"
        mime="text/plain"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(screen.queryByRole("button", { name: t.preview.previewPdf })).toBeNull();
    unmount();

    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(screen.getByRole("button", { name: t.preview.previewPdf })).not.toBeDisabled();
  });

  it("podgląd PDF-a jest WYŁĄCZONY, dopóki nie ma podpisanego URL-a", () => {
    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(screen.getByRole("button", { name: t.preview.previewPdf })).toBeDisabled();
  });

  it("podgląd PDF-a otwiera okno z natywną przeglądarką w iframie", () => {
    h.url.data = PDF_URL;
    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    expect(document.querySelector("iframe")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t.preview.previewPdf }));

    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(`${PDF_URL}#toolbar=1&navpanes=0`);
  });

  it("link pobierania podpowiada nazwę pliku i nie wynosi referrera", () => {
    h.url.data = PDF_URL;
    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    const link = screen.getByRole("link", { name: t.download });
    expect(link.getAttribute("href")).toBe(PDF_URL);
    expect(link.getAttribute("download")).toBe("raport.pdf");
    expect(link.getAttribute("rel")).toBe("noreferrer noopener");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("aria-disabled")).toBe("false");
  });

  it("bez podpisanego URL-a pobieranie ogłasza się jako niedostępne i BLOKUJE kliknięcie", () => {
    render(
      <AttachmentFile
        path={FILE_PATH}
        name="raport.pdf"
        mime="application/pdf"
        size={2048}
        mine={false}
        lang="pl"
      />,
    );
    const link = screen.getByRole("link", { name: t.download });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.getAttribute("href")).toBe("#");

    // `fireEvent` zwraca `false`, gdy uchwyt wywołał `preventDefault`.
    expect(fireEvent.click(link)).toBe(false);
  });
});

function lightboxProps(overrides: Partial<ImageLightboxProps> = {}): ImageLightboxProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    images: [{ url: PHOTO_URL, name: "krajobraz.png" }],
    index: 0,
    ...overrides,
  };
}

const GALLERY: ReadonlyArray<{ url: string; name: string }> = [
  { url: `${PHOTO_URL}?i=1`, name: "pierwsze.png" },
  { url: `${PHOTO_URL}?i=2`, name: "drugie.png" },
  { url: `${PHOTO_URL}?i=3`, name: "trzecie.png" },
];

/** Ile kliknięć „powiększ" dzieli 100% od sufitu podglądu. */
const CLICKS_TO_CEILING = Math.ceil((LIGHTBOX_MAX_ZOOM - LIGHTBOX_MIN_ZOOM) / LIGHTBOX_ZOOM_STEP);

describe("ImageLightbox - pełnoekranowy podgląd", () => {
  it("zamknięty podgląd nie zostawia po sobie DOM-u", () => {
    render(<ImageLightbox {...lightboxProps({ open: false })} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("pojedyncze zdjęcie nie udaje galerii - bez licznika i bez strzałek", () => {
    render(<ImageLightbox {...lightboxProps()} />);

    expect(screen.queryByRole("button", { name: t.preview.prev })).toBeNull();
    expect(screen.queryByRole("button", { name: t.preview.next })).toBeNull();
    expect(screen.queryByText(fill(t.preview.counter, { index: 1, total: 1 }))).toBeNull();
  });

  it("galeria pokazuje pozycję zdjęcia i obie strzałki", () => {
    render(<ImageLightbox {...lightboxProps({ images: GALLERY, index: 1 })} />);

    expect(screen.getByText(fill(t.preview.counter, { index: 2, total: 3 }))).toBeTruthy();
    expect(screen.getByRole("button", { name: t.preview.prev })).toBeTruthy();
    expect(screen.getByRole("button", { name: t.preview.next })).toBeTruthy();
  });

  it("strzałki ZAWIJAJĄ galerię na obu końcach", () => {
    const onIndexChange = vi.fn();
    const { unmount } = render(
      <ImageLightbox {...lightboxProps({ images: GALLERY, index: 0, onIndexChange })} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t.preview.prev }));
    expect(onIndexChange).toHaveBeenLastCalledWith(GALLERY.length - 1);
    unmount();

    render(<ImageLightbox {...lightboxProps({ images: GALLERY, index: 2, onIndexChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t.preview.next }));
    expect(onIndexChange).toHaveBeenLastCalledWith(0);
  });

  it("„pomniejsz” i „dopasuj” są WYŁĄCZONE na 100% - nie ma czego cofać", () => {
    render(<ImageLightbox {...lightboxProps()} />);

    expect(screen.getByRole("button", { name: t.preview.zoomOut })).toBeDisabled();
    expect(screen.getByRole("button", { name: t.preview.reset })).toBeDisabled();
    expect(screen.getByRole("button", { name: t.preview.zoomIn })).not.toBeDisabled();
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("„powiększ” wyłącza się dopiero na suficie zoomu", () => {
    render(<ImageLightbox {...lightboxProps()} />);
    const zoomIn = screen.getByRole("button", { name: t.preview.zoomIn });

    for (let i = 0; i < CLICKS_TO_CEILING - 1; i += 1) fireEvent.click(zoomIn);
    expect(zoomIn).not.toBeDisabled();

    fireEvent.click(zoomIn);

    expect(zoomIn).toBeDisabled();
    expect(screen.getByText(`${LIGHTBOX_MAX_ZOOM * 100}%`)).toBeTruthy();
    // Po powiększeniu jest już co cofnąć.
    expect(screen.getByRole("button", { name: t.preview.zoomOut })).not.toBeDisabled();
  });

  it("klawiatura przewija galerię, gdy podgląd jest OTWARTY", () => {
    const onIndexChange = vi.fn();
    render(<ImageLightbox {...lightboxProps({ images: GALLERY, index: 0, onIndexChange })} />);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onIndexChange).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onIndexChange).toHaveBeenLastCalledWith(GALLERY.length - 1);
  });

  it("klawiatura MILCZY przy zamkniętym podglądzie - inaczej listy pod spodem skakałyby", () => {
    const onIndexChange = vi.fn();
    render(
      <ImageLightbox
        {...lightboxProps({ open: false, images: GALLERY, index: 0, onIndexChange })}
      />,
    );

    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "+" });

    expect(onIndexChange).not.toHaveBeenCalled();
  });

  it("klawisze +, - i 0 sterują powiększeniem", () => {
    render(<ImageLightbox {...lightboxProps()} />);

    fireEvent.keyDown(window, { key: "+" });
    expect(screen.getByText("140%")).toBeTruthy();

    fireEvent.keyDown(window, { key: "+" });
    expect(screen.getByText("180%")).toBeTruthy();

    fireEvent.keyDown(window, { key: "-" });
    expect(screen.getByText("140%")).toBeTruthy();

    fireEvent.keyDown(window, { key: "0" });
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("klawisz „r” obraca obraz o ćwierć obrotu", () => {
    render(<ImageLightbox {...lightboxProps()} />);
    const img = screen.getByRole("img", { name: "krajobraz.png" });
    expect(img.getAttribute("style")).toContain("rotate(0deg)");

    fireEvent.keyDown(window, { key: "r" });

    expect(screen.getByRole("img", { name: "krajobraz.png" }).getAttribute("style")).toContain(
      "rotate(90deg)",
    );
  });

  it("przycisk zamknięcia zgłasza zamknięcie właścicielowi stanu", () => {
    const onOpenChange = vi.fn();
    render(<ImageLightbox {...lightboxProps({ onOpenChange })} />);

    fireEvent.click(screen.getByRole("button", { name: t.preview.close }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("podgląd BEZ adresu obrazu pokazuje ładowanie i nie oferuje pobrania pustki", () => {
    render(<ImageLightbox {...lightboxProps({ images: [{ url: "", name: "uszkodzone.png" }] })} />);

    expect(screen.getByText(t.mediaHistory.loading)).toBeTruthy();
    expect(screen.queryByRole("link", { name: t.preview.download })).toBeNull();
    expect(screen.queryByRole("link", { name: t.preview.openInNewTab })).toBeNull();
  });

  it("gotowy obraz daje pobranie pod nazwą pliku i otwarcie w nowej karcie", () => {
    render(<ImageLightbox {...lightboxProps()} />);

    const download = screen.getByRole("link", { name: t.preview.download });
    expect(download.getAttribute("href")).toBe(PHOTO_URL);
    expect(download.getAttribute("download")).toBe("krajobraz.png");

    const newTab = screen.getByRole("link", { name: t.preview.openInNewTab });
    expect(newTab.getAttribute("target")).toBe("_blank");
    expect(newTab.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("zdjęcie bez nazwy nadal ma opis w tytule okna i w alcie", () => {
    render(<ImageLightbox {...lightboxProps({ images: [{ url: PHOTO_URL, name: null }] })} />);

    expect(screen.getByRole("img", { name: t.photo })).toBeTruthy();
  });
});

function pdfProps(overrides: Partial<PdfPreviewDialogProps> = {}): PdfPreviewDialogProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    url: PDF_URL,
    name: "raport-kwartalny.pdf",
    ...overrides,
  };
}

describe("PdfPreviewDialog - szybki podgląd PDF", () => {
  it("okno tytułuje się nazwą pliku, a iframe wymusza pasek narzędzi bez panelu nawigacji", () => {
    render(<PdfPreviewDialog {...pdfProps()} />);

    expect(screen.getAllByText("raport-kwartalny.pdf").length).toBeGreaterThan(0);
    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(`${PDF_URL}#toolbar=1&navpanes=0`);
    expect(iframe?.getAttribute("title")).toBe("raport-kwartalny.pdf");
  });

  it("plik bez nazwy dostaje tytuł rodzajowy, nie puste okno", () => {
    render(<PdfPreviewDialog {...pdfProps({ name: null })} />);

    expect(screen.getAllByText(t.preview.pdfTitle).length).toBeGreaterThan(0);
    expect(document.querySelector("iframe")?.getAttribute("title")).toBe(t.preview.pdfTitle);
  });

  it("dopóki nie ma URL-a: komunikat ładowania, żadnego iframe'a i ŻADNYCH linków", () => {
    render(<PdfPreviewDialog {...pdfProps({ url: null })} />);

    expect(screen.getByText(t.preview.pdfLoading)).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByTitle(t.preview.download)).toBeNull();
    expect(screen.queryByTitle(t.preview.openInNewTab)).toBeNull();
  });

  it("z URL-em wracają obie akcje: pobranie pod nazwą i otwarcie w nowej karcie", () => {
    render(<PdfPreviewDialog {...pdfProps()} />);

    const download = screen.getByTitle(t.preview.download);
    expect(download.getAttribute("href")).toBe(PDF_URL);
    expect(download.getAttribute("download")).toBe("raport-kwartalny.pdf");

    const newTab = screen.getByTitle(t.preview.openInNewTab);
    expect(newTab.getAttribute("target")).toBe("_blank");
    expect(newTab.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("przycisk zamknięcia zgłasza zamknięcie właścicielowi stanu", () => {
    const onOpenChange = vi.fn();
    render(<PdfPreviewDialog {...pdfProps({ onOpenChange })} />);

    fireEvent.click(screen.getByRole("button", { name: t.preview.close }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
