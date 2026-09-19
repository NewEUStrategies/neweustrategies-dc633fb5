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
});
