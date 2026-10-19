// Uchwyty zmiany rozmiaru w kanwie buildera (ResizableBox, ResizableImageWrap):
// DOKŁADNA geometria zapisu, nie sam fakt wywołania.
//
// Co udowadniamy i dlaczego: uchwyt zapisuje do treści widgetu liczby, które
// potem czyta panel i strona publiczna. Przypinamy więc wartości: przyrost
// z przeciągnięcia dodany do zmierzonego rozmiaru, dolne granice (minW/minH,
// 20 px dla obrazu), zachowanie proporcji obrazu (większy z przyrostów, oś Y
// przeliczona przez proporcję), brak zapisu bez ruchu i brak „ruchu" przed
// chwyceniem. Klik w uchwyt nie może wyjść do widgetu - inaczej kanwa
// traktuje go jak zaznaczenie i przełącza panel w trakcie zmiany rozmiaru.
//
// Granice: react-i18next -> echo klucza (etykiety uchwytu), getBoundingClientRect
// -> stały prostokąt (happy-dom nie liczy układu).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { ResizableBox, ResizableImageWrap } from "../resizeWrappers";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "pl" } }),
}));

function stubRect(width: number, height: number) {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ width, height, top: 0, left: 0, right: width, bottom: height } as DOMRect);
}

function drag(handle: Element, dx: number, dy: number) {
  fireEvent.pointerDown(handle, { clientX: 10, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientX: 10 + dx, clientY: 10 + dy, pointerId: 1 });
  fireEvent.pointerUp(handle, { clientX: 10 + dx, clientY: 10 + dy, pointerId: 1 });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ResizableBox - zapis szerokości i wysokości", () => {
  it("dodaje przyrost przeciągnięcia do zmierzonego rozmiaru i zaokrągla", () => {
    stubRect(100.4, 40.4);
    const onCommit = vi.fn();
    const { getByRole } = render(
      <ResizableBox enabled widthPx={100} heightPx={40} onCommit={onCommit}>
        <button type="button">CTA</button>
      </ResizableBox>,
    );
    drag(getByRole("slider", { name: "builder.chrome.resize" }), 60, 30);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(160, 70);
  });

  it("nie schodzi poniżej minW/minH przy przeciągnięciu do środka", () => {
    stubRect(100, 40);
    const onCommit = vi.fn();
    const { getByRole } = render(
      <ResizableBox enabled minW={50} minH={30} onCommit={onCommit}>
        <span>x</span>
      </ResizableBox>,
    );
    drag(getByRole("slider"), -500, -500);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(50, 30);
  });

  it("puszczenie bez ruchu i ruch bez chwycenia niczego nie zapisują", () => {
    stubRect(100, 40);
    const onCommit = vi.fn();
    const { getByRole } = render(
      <ResizableBox enabled onCommit={onCommit}>
        <span>x</span>
      </ResizableBox>,
    );
    const handle = getByRole("slider");
    fireEvent.pointerMove(handle, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(handle.getAttribute("title")).toBe("builder.chrome.dragResize");
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("klik w uchwyt nie dociera do widgetu (zaznaczenie w kanwie)", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <div onClick={onSelect}>
        <ResizableBox enabled onCommit={() => {}}>
          <span>x</span>
        </ResizableBox>
      </div>,
    );
    fireEvent.click(getByRole("slider"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ResizableImageWrap - zapis szerokości obrazu", () => {
  it("zachowuje proporcje: większy z przyrostów, oś Y przez proporcję obrazu", () => {
    stubRect(200, 100); // proporcja 2:1
    const onCommit = vi.fn();
    const { getByRole } = render(
      <ResizableImageWrap enabled currentPx={200} onCommit={onCommit}>
        <img src="https://cdn.example/i.png" alt="" />
      </ResizableImageWrap>,
    );
    const handle = getByRole("slider", { name: "builder.chrome.resizeImage" });
    // dx=10, dy=50 -> max(10, 50 * 2) = 100 -> 300 px.
    fireEvent.pointerDown(handle, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 50, pointerId: 1 });
    expect(handle.getAttribute("title")).toBe("builder.chrome.dragResize - 300px");
    fireEvent.pointerUp(handle, { clientX: 10, clientY: 50, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(300);
  });

  it("nie zapisuje mniej niż 20 px; klik w uchwyt nie wychodzi do widgetu", () => {
    stubRect(120, 60);
    const onCommit = vi.fn();
    const onSelect = vi.fn();
    const { getByRole } = render(
      <div onClick={onSelect}>
        <ResizableImageWrap enabled currentPx={undefined} onCommit={onCommit}>
          <img src="https://cdn.example/i.png" alt="" />
        </ResizableImageWrap>
      </div>,
    );
    drag(getByRole("slider"), -400, -400);
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(20);
    fireEvent.click(getByRole("slider"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("wyłączony wrapper nie dodaje uchwytu", () => {
    const { queryByRole } = render(
      <ResizableImageWrap enabled={false} currentPx={100} onCommit={() => {}}>
        <img src="https://cdn.example/i.png" alt="" />
      </ResizableImageWrap>,
    );
    expect(queryByRole("slider")).toBeNull();
  });
});
