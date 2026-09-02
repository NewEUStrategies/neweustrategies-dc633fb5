// Podgląd pełnoekranowy - GESTY: kółko myszy i przeciąganie powiększonego
// obrazu.
//
// `attachmentSurfaces.test.tsx` pokrywa chrome podglądu (pasek narzędzi,
// klawiatura, galeria, pobieranie). Zostały gesty wskaźnika - cztery handlery
// (`onWheel`, `onPointerDown`, `onPointerMove`, `onPointerUp`), które są jedyną
// drogą, żeby OBEJRZEĆ szczegół zdjęcia: bez nich powiększenie pokazuje środek
// kadru i nic więcej. Arytmetyka progów ma własne testy
// (`lib/chat/__tests__/attachmentPresentation.test.ts`); tutaj chodzi o to, czy
// gest w ogóle dochodzi do stanu komponentu.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@/lib/i18n-chat";
import { chatPl } from "@/lib/i18n-chat";
import { LIGHTBOX_MAX_ZOOM } from "@/lib/chat/attachmentPresentation";
import { ImageLightbox } from "../AttachmentPreview";

const t = chatPl.chat;
const IMAGE = { url: "blob:podglad/1", name: "wykres.png" };

afterEach(() => cleanup());

function renderLightbox() {
  const utils = render(<ImageLightbox open onOpenChange={() => {}} images={[IMAGE]} index={0} />);
  const image = screen.getByAltText(IMAGE.name);
  const canvas = image.parentElement;
  if (!canvas) throw new Error("test: obraz nie ma kontenera płótna");
  return { ...utils, image, canvas };
}

/** Odczyt procentu powiększenia z paska narzędzi. */
function zoomPercent(): number {
  const label = screen.getByText(/%$/);
  return Number.parseInt(label.textContent ?? "0", 10);
}

describe("kółko myszy", () => {
  // MODYFIKATORY (Ctrl / Cmd) NIE MAJĄ TU DOWODU RENDEROWEGO - i to jest
  // ograniczenie środowiska, nie luka. `WheelEvent` w happy-dom gubi pola
  // z `MouseEventInit` (`ctrlKey`, `metaKey`), więc zdarzenie dociera do
  // handlera z `ctrlKey === false` i test „z Ctrl przybliża" dowodziłby
  // wyłącznie progu 20 px, czyli tego samego, co test niżej. Gałąź
  // modyfikatora ma pełny dowód jednostkowy w `shouldZoomOnWheel`
  // (`src/lib/chat/__tests__/attachmentPresentation.test.ts`), a tutaj
  // dowodzimy, że handler w ogóle dochodzi do stanu komponentu.
  it("DELIKATNE przewinięcie gładzikiem bez modyfikatora NIE rusza powiększenia", () => {
    const { canvas } = renderLightbox();
    fireEvent.wheel(canvas, { deltaY: 19 });
    fireEvent.wheel(canvas, { deltaY: -19 });
    expect(zoomPercent()).toBe(100);
  });

  it("wyraźny obrót kółka bez modyfikatora już przybliża", () => {
    const { canvas } = renderLightbox();
    fireEvent.wheel(canvas, { deltaY: -120 });
    expect(zoomPercent()).toBe(140);
  });

  it("kółko nie przekracza sufitu powiększenia", () => {
    const { canvas } = renderLightbox();
    for (let i = 0; i < 30; i += 1) fireEvent.wheel(canvas, { deltaY: -120 });
    expect(zoomPercent()).toBe(LIGHTBOX_MAX_ZOOM * 100);
  });
});

describe("przeciąganie powiększonego obrazu", () => {
  function zoomIn(times = 1): void {
    for (let i = 0; i < times; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: t.preview.zoomIn }));
    }
  }

  it("W 100% przeciąganie NIE rusza kadru - nie ma czego przesuwać", () => {
    const { canvas, image } = renderLightbox();
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    expect(image.getAttribute("style") ?? "").toContain("translate(0px, 0px)");
  });

  it("po powiększeniu przeciągnięcie PRZESUWA kadr o różnicę wskaźnika", () => {
    const { canvas, image } = renderLightbox();
    zoomIn();

    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 130, clientY: 80, pointerId: 1 });

    expect(image.getAttribute("style") ?? "").toContain("translate(30px, -20px)");
  });

  it("kolejne przeciągnięcie liczy się OD BIEŻĄCEGO przesunięcia, nie od zera", () => {
    const { canvas, image } = renderLightbox();
    zoomIn();

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 5, clientY: 5, pointerId: 1 });

    expect(image.getAttribute("style") ?? "").toContain("translate(15px, 15px)");
  });

  it("PUSZCZENIE wskaźnika kończy przeciąganie - kursor bez przycisku nie ciągnie kadru", () => {
    const { canvas, image } = renderLightbox();
    zoomIn();

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 400, clientY: 0, pointerId: 1 });

    expect(image.getAttribute("style") ?? "").toContain("translate(40px, 0px)");
  });

  it("ANULOWANIE wskaźnika (gest przerwany przez system) też kończy przeciąganie", () => {
    const { canvas, image } = renderLightbox();
    zoomIn();

    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 25, clientY: 0, pointerId: 1 });
    fireEvent.pointerCancel(canvas, { pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 300, clientY: 0, pointerId: 1 });

    expect(image.getAttribute("style") ?? "").toContain("translate(25px, 0px)");
  });

  it("„dopasuj” cofa JEDNOCZEŚNIE powiększenie i przesunięcie", () => {
    const { canvas, image } = renderLightbox();
    zoomIn();
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 60, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });

    fireEvent.click(screen.getByRole("button", { name: t.preview.reset }));

    expect(zoomPercent()).toBe(100);
    expect(image.getAttribute("style") ?? "").toContain("translate(0px, 0px)");
  });

  it("przycisk obrotu obraca kadr o ćwierć obrotu przy każdym kliknięciu", () => {
    const { image } = renderLightbox();
    const rotate = screen.getByRole("button", { name: t.preview.rotate });

    fireEvent.click(rotate);
    expect(image.getAttribute("style") ?? "").toContain("rotate(90deg)");
    fireEvent.click(rotate);
    fireEvent.click(rotate);
    fireEvent.click(rotate);
    expect(image.getAttribute("style") ?? "").toContain("rotate(0deg)");
  });
});
