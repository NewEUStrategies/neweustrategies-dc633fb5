// Kontrakt globalnego obszaru wgrywania. Asercje pilnują tego, co rozjechało
// się w kilkunastu własnych implementacjach przed ujednoliceniem: podwójnego
// otwierania pickera, reagowania na przeciąganie, które nie niesie pliku,
// braku resetu inputu po nieudanej wysyłce i klikalności w stanie zajętości.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FileVideo, FileAudio, FileText } from "lucide-react";

import { UploadArea } from "../upload-area";

afterEach(cleanup);

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("brak inputu pliku");
  return input;
}

function renderArea(props: Partial<React.ComponentProps<typeof UploadArea>> = {}) {
  const onFiles = vi.fn();
  render(
    <UploadArea
      title="Wgraj materiał"
      description="PDF, wideo lub audio do 200 MB."
      ctaLabel="Wybierz plik"
      onFiles={onFiles}
      {...props}
    />,
  );
  return { onFiles };
}

const sample = (name = "raport.pdf") => new File(["x"], name, { type: "application/pdf" });

describe("UploadArea", () => {
  it("renderuje tytuł, opis i CTA oraz wiąże je z obszarem", () => {
    renderArea();
    const area = screen.getByRole("group");
    expect(screen.getByText("Wgraj materiał")).toBeInTheDocument();
    expect(screen.getByText("PDF, wideo lub audio do 200 MB.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wybierz plik" })).toBeInTheDocument();
    expect(area).toHaveAccessibleName("Wgraj materiał");
  });

  it("wachlarz trzech ikon dostaje trzy kafle, pojedyncza ikona jeden", () => {
    const { unmount } = render(
      <UploadArea
        title="A"
        description="B"
        ctaLabel="C"
        icons={[FileText, FileVideo, FileAudio]}
        onFiles={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('[data-slot="upload-area"] .ring-border')).toHaveLength(3);
    unmount();
    renderArea();
    expect(document.querySelectorAll('[data-slot="upload-area"] .ring-border')).toHaveLength(1);
  });

  it("DWIE ikony dają DWA kafle - trzecia droga klastra nie gubi po cichu ikony", () => {
    // Pierwsza wersja rozgałęziała się wyłącznie na `length === 3`, więc pole
    // z dwiema ikonami renderowało tylko pierwszą. Połowa powierzchni podaje
    // dokładnie dwie, więc strata była cicha i powszechna.
    const { unmount } = render(
      <UploadArea
        title="A"
        description="B"
        ctaLabel="C"
        icons={[FileText, FileVideo]}
        onFiles={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('[data-slot="upload-area"] .ring-border')).toHaveLength(2);
    unmount();
  });

  it("klik w natywne kontrolki mediów w podglądzie NIE otwiera okna wyboru pliku", () => {
    // Kontrolki `<audio controls>` żyją w shadow DOM, więc klik w „play"
    // bąbelkuje do obszaru jako klik w element medialny. Bez wyjątku na liście
    // elementów interaktywnych odsłuchanie wgranego nagrania otwierałoby picker.
    renderArea({ preview: <audio controls data-testid="odtwarzacz" /> });
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    fireEvent.click(screen.getByTestId("odtwarzacz"));
    expect(click).not.toHaveBeenCalled();
  });

  it("upuszczony plik SPOZA `accept` nie idzie do wysyłki, tylko do `onRejectedFiles`", () => {
    // Przeglądarka egzekwuje `accept` WYŁĄCZNIE w oknie systemowym - z
    // upuszczenia leci wszystko. Filtr stoi więc we wspólnej powłoce.
    const onFiles = vi.fn();
    const onRejectedFiles = vi.fn();
    renderArea({ accept: "image/png,.webp", onFiles, onRejectedFiles });
    const area = screen.getByRole("group");

    fireEvent.drop(area, {
      dataTransfer: {
        types: ["Files"],
        files: [
          new File(["x"], "okladka.png", { type: "image/png" }),
          new File(["x"], "raport.pdf", { type: "application/pdf" }),
          new File(["x"], "grafika.webp", { type: "" }),
        ],
      },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual([
      "okladka.png",
      "grafika.webp",
    ]);
    expect(onRejectedFiles).toHaveBeenCalledTimes(1);
    expect(onRejectedFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(["raport.pdf"]);
  });

  it("wybór z okna systemowego NIE jest filtrowany przez `accept` - tam decyduje walidacja wywołującego", () => {
    // Użytkownik może w oknie przełączyć filtr na „wszystkie pliki". Zachowanie
    // zostaje takie, jakie było przed ujednoliceniem: plik dociera do
    // wywołującego, a ten ma własną walidację przed wysyłką.
    const onFiles = vi.fn();
    renderArea({ accept: "image/png", onFiles });
    fireEvent.change(fileInput(), { target: { files: [sample("raport.pdf")] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
  });

  it("kliknięcie w tło obszaru otwiera picker", () => {
    renderArea();
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("group"));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("kliknięcie w CTA otwiera picker DOKŁADNIE raz (zdarzenie bąbelkuje do obszaru)", () => {
    renderArea();
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Wybierz plik" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("wybór pliku emituje listę i czyści input (ten sam plik da się wybrać ponownie)", () => {
    const { onFiles } = renderArea();
    const input = fileInput();
    fireEvent.change(input, { target: { files: [sample()] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0].name).toBe("raport.pdf");
    expect(input.value).toBe("");
  });

  it("upuszczenie pliku emituje listę i gasi podświetlenie", () => {
    const { onFiles } = renderArea();
    const area = screen.getByRole("group");
    fireEvent.dragEnter(area, { dataTransfer: { types: ["Files"], files: [] } });
    expect(area).toHaveAttribute("data-drag-over", "true");
    fireEvent.drop(area, { dataTransfer: { types: ["Files"], files: [sample("wideo.mp4")] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(area).not.toHaveAttribute("data-drag-over");
  });

  it("przeciąganie BEZ plików (np. kafel z biblioteki mediów) nie podświetla obszaru", () => {
    const { onFiles } = renderArea();
    const area = screen.getByRole("group");
    fireEvent.dragEnter(area, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(area).not.toHaveAttribute("data-drag-over");
    fireEvent.drop(area, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("upuszczenie z PUSTĄ listą `types`, ale z plikiem, wciąż jest przyjmowane", () => {
    // `types` jest jedynym sygnałem przy `dragover` (przeglądarka ukrywa tam
    // `files`), ale przy `drop` pliki są już jawne. Wymaganie wpisu „Files"
    // także w tym momencie gubiło zrzut z `DataTransfer` złożonego ręcznie -
    // tak robią starsze WebKity, integracje i harnessy testowe. Warunek gestu
    // (tekst/odnośnik) nadal nie przechodzi, bo tam `files` jest puste.
    const { onFiles } = renderArea();
    const area = screen.getByRole("group");

    fireEvent.drop(area, { dataTransfer: { types: [], files: [sample("umowa.pdf")] } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0][0].name).toBe("umowa.pdf");
  });

  it("upuszczenie NIE DOCHODZI do rodzica, który też słucha plików (brak podwójnej wysyłki)", () => {
    // Obszar bywa osadzony w kanwie, która sama przyjmuje upuszczenie (biblioteka
    // mediów, dialog wyboru pliku). Gdyby zdarzenie bąbelkowało dalej, ten sam
    // plik poszedłby do wysyłki dwa razy.
    const onFiles = vi.fn();
    const rodzic = vi.fn();
    render(
      <div onDrop={rodzic} onDragOver={rodzic}>
        <UploadArea title="A" description="B" ctaLabel="C" onFiles={onFiles} />
      </div>,
    );
    const area = screen.getByRole("group");
    fireEvent.dragOver(area, { dataTransfer: { types: ["Files"], files: [] } });
    fireEvent.drop(area, { dataTransfer: { types: ["Files"], files: [sample()] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(rodzic).not.toHaveBeenCalled();
  });

  it("stan zajętości: spinner w CTA, `aria-busy`, brak reakcji na kliknięcie i upuszczenie", () => {
    const { onFiles } = renderArea({ busy: true, busyLabel: "Wgrywanie…" });
    const area = screen.getByRole("group");
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    expect(area).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Wgrywanie…" })).toBeDisabled();
    fireEvent.click(area);
    fireEvent.drop(area, { dataTransfer: { types: ["Files"], files: [sample()] } });
    expect(click).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("stan wyłączony blokuje picker i oznacza obszar dla czytników ekranu", () => {
    renderArea({ disabled: true });
    const area = screen.getByRole("group");
    const click = vi.spyOn(fileInput(), "click").mockImplementation(() => {});
    expect(area).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(area);
    expect(click).not.toHaveBeenCalled();
  });

  it("błąd trafia do `role=alert` i przejmuje opis obszaru", () => {
    renderArea({ error: "Plik jest za duży." });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Plik jest za duży.");
    expect(screen.getByRole("group").getAttribute("aria-describedby")).toBe(alert.id);
  });

  it("podgląd zastępuje klaster ikon, a akcje i stopka renderują się w obszarze", () => {
    renderArea({
      preview: <img src="/okladka.png" alt="Podgląd okładki" />,
      actions: (
        <button type="button" key="rm">
          Usuń
        </button>
      ),
      footer: <span>stopka</span>,
    });
    expect(screen.getByAltText("Podgląd okładki")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-slot="upload-area"] .ring-border')).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Usuń" })).toBeInTheDocument();
    expect(screen.getByText("stopka")).toBeInTheDocument();
  });

  it("ukryte pole pliku stoi NA KOŃCU obszaru - przed nim widoczne kontrolki", () => {
    // Pola formularzy bywają wyszukiwane jako „pierwszy `input` w kontenerze
    // etykiety" (tak robi m.in. uprząż testowa panelu prelegentów). Picker
    // wpięty na początku przechwytywałby takie zapytania zamiast widocznej
    // kontrolki, więc jego pozycja jest kontraktem, nie kosmetyką.
    renderArea({ footer: <input type="url" aria-label="Adres" /> });
    const area = screen.getByRole("group");
    const inputs = Array.from(area.querySelectorAll("input"));
    expect(inputs).toHaveLength(2);
    expect(inputs[0].getAttribute("type")).toBe("url");
    expect(inputs[1].getAttribute("type")).toBe("file");
    expect(area.lastElementChild?.getAttribute("type")).toBe("file");
  });

  it("przekazuje `accept` i `multiple` do inputu", () => {
    renderArea({ accept: "video/mp4,audio/mpeg", multiple: true });
    const input = fileInput();
    expect(input.getAttribute("accept")).toBe("video/mp4,audio/mpeg");
    expect(input.multiple).toBe(true);
  });

  it("podświetlenie LICZY wejścia i wyjścia - przejazd nad dzieckiem go nie gasi", () => {
    // `dragleave` leci TAKŻE wtedy, gdy kursor przechodzi z obszaru na jego
    // własne dziecko (kafel ikony, podgląd, CTA). Bez licznika głębokości
    // ramka migałaby na każdym elemencie w środku, a przy gęstym klastrze
    // ikon - kilka razy na sekundę.
    renderArea();
    const area = screen.getByRole("group");
    const dziecko = screen.getByText("Wgraj materiał");
    const files = { dataTransfer: { types: ["Files"], files: [] } };

    fireEvent.dragEnter(area, files);
    expect(area).toHaveAttribute("data-drag-over", "true");

    fireEvent.dragEnter(dziecko, files);
    fireEvent.dragLeave(area, files);
    // Wyjście z rodzica przy wciąż „otwartym" dziecku NIE gasi podświetlenia.
    expect(area).toHaveAttribute("data-drag-over", "true");

    fireEvent.dragLeave(dziecko, files);
    expect(area).not.toHaveAttribute("data-drag-over");
  });

  it("`dragover` z plikiem jest ANULOWANY - bez tego przeglądarka otwiera plik zamiast oddać go stronie", () => {
    // `preventDefault` na `dragover` nie jest kosmetyką: domyślną akcją
    // przeglądarki jest NAWIGACJA do upuszczonego pliku, więc bez anulowania
    // obszar w ogóle nie dostaje `drop`. Gest bez plików musi zostać
    // nieanulowany, żeby przeciąganie tekstu działało jak zwykle.
    renderArea();
    const area = screen.getByRole("group");

    const zPlikiem = fireEvent.dragOver(area, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    const bezPliku = fireEvent.dragOver(area, {
      dataTransfer: { types: ["text/plain"], files: [] },
    });

    // `fireEvent` oddaje `false`, gdy zdarzenie zostało anulowane.
    expect(zPlikiem).toBe(false);
    expect(bezPliku).toBe(true);
  });

  it("stan zajętości BEZ własnej etykiety zostawia napis CTA, a `data-busy` i tak stoi", () => {
    renderArea({ busy: true });
    expect(screen.getByRole("button", { name: "Wybierz plik" })).toBeDisabled();
    expect(screen.getByRole("group")).toHaveAttribute("data-busy", "true");
  });

  it("własny `errorId` wiąże komunikat rodzica, a nie wygenerowany identyfikator", () => {
    // Formularz kariery sam wskazuje `aria-describedby` na swój węzeł błędu -
    // obszar musi użyć TEGO identyfikatora, inaczej czytnik ekranu czyta opis
    // pola zamiast powodu odmowy.
    renderArea({ error: "Plik jest za duży.", errorId: "cv-blad" });
    const alert = screen.getByRole("alert");
    expect(alert.id).toBe("cv-blad");
    expect(screen.getByRole("group").getAttribute("aria-describedby")).toBe("cv-blad");
  });

  it("identyfikatory dla testów i formularzy schodzą na właściwe węzły", () => {
    renderArea({
      "data-testid": "obszar-cv",
      inputTestId: "picker-cv",
      inputId: "cv-plik",
      inputLabel: "Wgraj CV",
      name: "cv",
    });
    const input = screen.getByTestId("picker-cv") as HTMLInputElement;
    expect(screen.getByTestId("obszar-cv")).toBe(screen.getByRole("group"));
    expect(input.id).toBe("cv-plik");
    expect(input.name).toBe("cv");
    expect(screen.getByLabelText("Wgraj CV")).toBe(input);
  });

  it("czwarta ikona jest OBCINANA - klaster ma najwyżej trzy kafle", () => {
    render(
      <UploadArea
        title="A"
        description="B"
        ctaLabel="C"
        icons={[FileText, FileVideo, FileAudio, FileText]}
        onFiles={vi.fn()}
      />,
    );
    expect(document.querySelectorAll('[data-slot="upload-area"] .ring-border')).toHaveLength(3);
  });
});
