// ConnectionPathTrail (molekuła): „Ty -> Anna -> Marek".
//
// To jest właściwa treść luki #6: drugi stopień był liczony w bazie od v2,
// ale użytkownik nigdy nie widział, PRZEZ KOGO droga biegnie. Testy pilnują
// trzech decyzji, które łatwo zepsuć przy kolejnej iteracji UI:
//   1. przy 3. stopniu środkowy węzeł zostaje BEZ NAZWY (to kontakt mojego
//      kontaktu, nie mój - jego ujawnienie byłoby wyciekiem cudzej sieci),
//   2. bez mostu nie rysujemy ścieżki w ogóle (droga, której nie umiemy
//      pokazać, nie ma być udawana),
//   3. wewnątrz linku całej karty most NIE jest linkiem (<a> w <a>).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { connectionBridge, translateKey as k } from "@/test/network/fixtures";

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ConnectionPathTrail } from "@/components/network/molecules/ConnectionPathTrail";

const BRIDGE = connectionBridge({ id: "u-anna", name: "Anna Nowak", slug: "anna-nowak" });
const TARGET = "Marek Kowal";

describe("ConnectionPathTrail", () => {
  it("2. stopień: Ty -> most -> osoba", () => {
    render(<ConnectionPathTrail degree={2} bridge={BRIDGE} targetName={TARGET} />);
    expect(screen.getByText(k("network.degree.you"))).toBeInTheDocument();
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText(TARGET)).toBeInTheDocument();
    // Bez węzła ukrytego - przy 2. stopniu nie ma czego ukrywać.
    expect(screen.queryByText(k("network.degree.hiddenNode"))).not.toBeInTheDocument();
  });

  it("3. stopień: środkowy węzeł istnieje, ale pozostaje nienazwany", () => {
    render(<ConnectionPathTrail degree={3} bridge={BRIDGE} targetName={TARGET} />);
    // Czytnik ekranu dowiaduje się, że po drodze jest ktoś jeszcze...
    expect(screen.getByText(k("network.degree.hiddenNode"))).toBeInTheDocument();
    // ...ale nazwisko tej osoby nie pada nigdzie w drzewie.
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText(TARGET)).toBeInTheDocument();
  });

  it("cała ścieżka jedzie do czytnika ekranu jako jedno zdanie", () => {
    render(<ConnectionPathTrail degree={3} bridge={BRIDGE} targetName={TARGET} />);
    const group = screen.getByRole("group");
    expect(group).toHaveAttribute(
      "aria-label",
      k("network.degree.pathAria", {
        path: [k("network.degree.you"), "Anna Nowak", k("network.degree.hiddenNode"), TARGET].join(
          " - ",
        ),
      }),
    );
  });

  it("bez mostu nie rysujemy ścieżki (znamy dystans, nie znamy drogi)", () => {
    const { container } = render(
      <ConnectionPathTrail degree={2} bridge={null} targetName={TARGET} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("1. stopień nie ma ścieżki - jesteśmy połączeni wprost", () => {
    const { container } = render(
      <ConnectionPathTrail degree={1} bridge={BRIDGE} targetName={TARGET} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("poza zasięgiem (0) nie ma ani ścieżki, ani obietnicy", () => {
    const { container } = render(
      <ConnectionPathTrail degree={0} bridge={BRIDGE} targetName={TARGET} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("most jest linkiem do profilu, gdy ma slug", () => {
    render(<ConnectionPathTrail degree={2} bridge={BRIDGE} targetName={TARGET} />);
    expect(screen.getByRole("link", { name: "Anna Nowak" })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
  });

  it("most bez sluga zostaje tekstem (nie ma dokąd prowadzić)", () => {
    render(
      <ConnectionPathTrail
        degree={2}
        bridge={connectionBridge({ name: "Anna Nowak", slug: null })}
        targetName={TARGET}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
  });

  it("interactive=false: żadnych linków (ścieżka mieszka wewnątrz linku karty)", () => {
    render(
      <ConnectionPathTrail degree={2} bridge={BRIDGE} targetName={TARGET} interactive={false} />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("osoba docelowa nigdy nie jest linkiem - jej profil ma własne CTA obok", () => {
    render(
      <ConnectionPathTrail
        degree={2}
        bridge={BRIDGE}
        targetName={TARGET}
        targetSlug="marek-kowal"
      />,
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Anna Nowak" })).toBeInTheDocument();
  });
});
