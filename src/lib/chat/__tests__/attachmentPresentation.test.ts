// Reguły prezentacji załączników - macierz typów MIME, wariant dymka
// i arytmetyka podglądu pełnoekranowego.
//
// PO CO. `AttachmentContent.tsx` miał 4,8% GAŁĘZI, a przez ten plik przechodzi
// każdy dokument przysłany przez użytkownika. Gałąź bez testu to gałąź, którą
// wolno przestawić po cichu - a tu „po cichu" znaczy: arkusz z ikoną
// prezentacji, nieudane przesyłanie z połamanym obrazkiem albo przycisk
// „pomniejsz" aktywny na 100%, bo zoom wynosi 0,9999999999999998.
import { describe, expect, it } from "vitest";
import { messageRow } from "@/test/chat/fixtures";
import {
  LIGHTBOX_MAX_ZOOM,
  LIGHTBOX_MIN_ZOOM,
  LIGHTBOX_ZOOM_STEP,
  attachmentVariant,
  clampLightboxIndex,
  clampZoom,
  fileIconKind,
  lightboxKeyIntent,
  nextRotation,
  shouldZoomOnWheel,
  wheelZoomDelta,
  wrapLightboxIndex,
  zoomBy,
} from "../attachmentPresentation";

describe("fileIconKind - macierz typów MIME", () => {
  it("arkusze rozpoznaje we WSZYSTKICH trzech rodzinach formatów", () => {
    for (const mime of [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.spreadsheet",
      "text/csv",
    ]) {
      expect(fileIconKind(mime)).toBe("spreadsheet");
    }
  });

  it("prezentacje rozpoznaje w obu rodzinach", () => {
    for (const mime of [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.oasis.opendocument.presentation",
    ]) {
      expect(fileIconKind(mime)).toBe("presentation");
    }
  });

  it("dokumenty tekstowe i PDF to jedna rodzina", () => {
    for (const mime of [
      "application/pdf",
      "text/plain",
      "text/markdown",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.oasis.opendocument.text",
      "application/rtf",
    ]) {
      expect(fileIconKind(mime)).toBe("document");
    }
  });

  it("BRAK typu MIME to ikona ogólna, nie „dokument”", () => {
    // Wiersz bez `attachment_mime` powstaje przy starszych wiadomościach
    // i przy przekazywaniu - ikona ma wtedy nie udawać wiedzy.
    expect(fileIconKind(null)).toBe("generic");
    expect(fileIconKind("")).toBe("generic");
  });

  it("nieznany typ trafia do dokumentów, a nie wywraca renderu", () => {
    expect(fileIconKind("application/x-nowy-format")).toBe("document");
  });

  it("arkusz WYGRYWA z prezentacją, gdy oba podciągi wystąpią", () => {
    // Kolejność warunków jest kontraktem: jeden plik nie może mieć dwóch ikon.
    expect(fileIconKind("application/vnd.spreadsheet-presentation")).toBe("spreadsheet");
  });
});

describe("attachmentVariant - wariant treści dymka", () => {
  it("każdy rodzaj załącznika ma własny atom", () => {
    expect(attachmentVariant(messageRow({ kind: "image", attachment_path: "t/c/u/a.png" }))).toBe(
      "image",
    );
    expect(attachmentVariant(messageRow({ kind: "audio", attachment_path: "t/c/u/a.webm" }))).toBe(
      "audio",
    );
    expect(attachmentVariant(messageRow({ kind: "file", attachment_path: "t/c/u/a.pdf" }))).toBe(
      "file",
    );
  });

  it("wiadomość tekstowa nie jest załącznikiem, nawet ze ścieżką w wierszu", () => {
    expect(attachmentVariant(messageRow({ kind: "text", attachment_path: "t/c/u/a.png" }))).toBe(
      "none",
    );
  });

  it("rodzaj BEZ ścieżki (nieudane przesyłanie) nie renderuje połamanego obrazka", () => {
    for (const kind of ["image", "audio", "file"] as const) {
      expect(attachmentVariant(messageRow({ kind, attachment_path: null }))).toBe("none");
    }
  });
});

describe("zoom podglądu", () => {
  it("nie schodzi poniżej 100% ani nie przekracza sufitu", () => {
    expect(clampZoom(0.2)).toBe(LIGHTBOX_MIN_ZOOM);
    expect(clampZoom(99)).toBe(LIGHTBOX_MAX_ZOOM);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it("krok w górę i w dół wraca DOKŁADNIE do wartości wyjściowej", () => {
    // Bez zaokrąglenia `1 + 0.4 - 0.4` daje 0.9999999999999999, a przycisk
    // „dopasuj" porównuje `zoom === 1`.
    expect(zoomBy(zoomBy(1, LIGHTBOX_ZOOM_STEP), -LIGHTBOX_ZOOM_STEP)).toBe(1);
  });

  it("wielokrotne oddalenie zatrzymuje się na 100%, a nie na 0,99999", () => {
    let zoom = 3;
    for (let i = 0; i < 10; i += 1) zoom = zoomBy(zoom, -LIGHTBOX_ZOOM_STEP);
    expect(zoom).toBe(LIGHTBOX_MIN_ZOOM);
  });

  it("wielokrotne przybliżenie zatrzymuje się na suficie", () => {
    let zoom = 1;
    for (let i = 0; i < 50; i += 1) zoom = zoomBy(zoom, LIGHTBOX_ZOOM_STEP);
    expect(zoom).toBe(LIGHTBOX_MAX_ZOOM);
  });

  it("kółko myszy zmienia zoom z modyfikatorem albo przy wyraźnym ruchu", () => {
    expect(shouldZoomOnWheel({ ctrlKey: true, metaKey: false, deltaY: 1 })).toBe(true);
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: true, deltaY: 1 })).toBe(true);
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: false, deltaY: 40 })).toBe(true);
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: false, deltaY: -40 })).toBe(true);
  });

  it("delikatne przewinięcie gładzikiem NIE skacze po powiększeniach", () => {
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: false, deltaY: 19 })).toBe(false);
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: false, deltaY: -19 })).toBe(false);
    // Dokładnie na progu już działa - warunek jest nieostry.
    expect(shouldZoomOnWheel({ ctrlKey: false, metaKey: false, deltaY: 20 })).toBe(true);
  });

  it("kierunek kółka: w dół oddala, w górę przybliża", () => {
    expect(wheelZoomDelta(120)).toBe(-LIGHTBOX_ZOOM_STEP);
    expect(wheelZoomDelta(-120)).toBe(LIGHTBOX_ZOOM_STEP);
    // Zero traktowane jak ruch w górę - tak zachowywał się kod przed ekstrakcją.
    expect(wheelZoomDelta(0)).toBe(LIGHTBOX_ZOOM_STEP);
  });
});

describe("obrót podglądu", () => {
  it("cztery kroki wracają do zera", () => {
    let rotation = 0;
    for (let i = 0; i < 4; i += 1) rotation = nextRotation(rotation);
    expect(rotation).toBe(0);
  });

  it("każdy krok to ćwierć obrotu", () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(90)).toBe(180);
    expect(nextRotation(270)).toBe(0);
  });
});

describe("indeks galerii", () => {
  it("przycięcie broni przed indeksem spoza zakresu", () => {
    expect(clampLightboxIndex(-3, 4)).toBe(0);
    expect(clampLightboxIndex(9, 4)).toBe(3);
    expect(clampLightboxIndex(2, 4)).toBe(2);
  });

  it("pusta galeria zawsze daje zero, a nie -1", () => {
    expect(clampLightboxIndex(5, 0)).toBe(0);
    expect(wrapLightboxIndex(0, 1, 0)).toBe(0);
  });

  it("strzałka na ostatnim zdjęciu zawija na pierwsze i odwrotnie", () => {
    expect(wrapLightboxIndex(2, 1, 3)).toBe(0);
    expect(wrapLightboxIndex(0, -1, 3)).toBe(2);
    expect(wrapLightboxIndex(1, 1, 3)).toBe(2);
  });
});

describe("skróty klawiaturowe podglądu", () => {
  it("strzałki przechodzą po galerii", () => {
    expect(lightboxKeyIntent("ArrowRight")).toBe("next");
    expect(lightboxKeyIntent("ArrowLeft")).toBe("prev");
  });

  it("plus i równa się przybliżają (klawiatura numeryczna i główna)", () => {
    expect(lightboxKeyIntent("+")).toBe("zoom-in");
    expect(lightboxKeyIntent("=")).toBe("zoom-in");
  });

  it("minus i podkreślenie oddalają", () => {
    expect(lightboxKeyIntent("-")).toBe("zoom-out");
    expect(lightboxKeyIntent("_")).toBe("zoom-out");
  });

  it("zero resetuje, R obraca - w obu wielkościach liter", () => {
    expect(lightboxKeyIntent("0")).toBe("reset");
    expect(lightboxKeyIntent("r")).toBe("rotate");
    expect(lightboxKeyIntent("R")).toBe("rotate");
  });

  it("klawisze bez znaczenia NIE są przechwytywane przed przeglądarką", () => {
    for (const key of ["Escape", "Tab", "a", "1", "Enter", " "]) {
      expect(lightboxKeyIntent(key)).toBe("none");
    }
  });
});
