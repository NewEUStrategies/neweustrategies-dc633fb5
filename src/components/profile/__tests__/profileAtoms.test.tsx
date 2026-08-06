// Atomy i molekuły profilu: etykieta pola z podpowiedzią, grupa odznak oraz
// bramka sesji. Trzy rzeczy, które łatwo zepsuć bez testu, bo „wyglądają tak
// samo": dostępna podpowiedź (przycisk, nie sam tytuł), normalizacja odznak
// przychodzących z bazy oraz to, że bramka NIE renderuje treści bez sesji.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  auth: { session: null as { user: { id: string } } | null, loading: false },
  language: { current: "pl" },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: h.auth.session, loading: h.auth.loading }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: h.language.current },
  }),
}));

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    Link: RouterLinkStub,
    useRouter: () => ({ history: { back: () => {} }, navigate: () => {} }),
  };
});

import { FieldLabel } from "../FieldLabel";
import { ProfileBadges } from "../ProfileBadges";
import { AuthGate } from "../AuthGate";
import { PROFILE_BADGE_KINDS } from "@/lib/profile/badgeCatalog";

beforeEach(() => {
  h.auth.session = null;
  h.auth.loading = false;
  h.language.current = "pl";
});

describe("FieldLabel", () => {
  it("wiąże etykietę z polem przez htmlFor", () => {
    render(
      <>
        <FieldLabel htmlFor="nick">Nazwa wyświetlana</FieldLabel>
        <input id="nick" />
      </>,
    );
    expect(screen.getByLabelText("Nazwa wyświetlana")).toBeInTheDocument();
  });

  it("renderuje dopisek pomocniczy obok etykiety", () => {
    render(<FieldLabel hint="(nick konta)">Nazwa</FieldLabel>);
    expect(screen.getByText("(nick konta)")).toBeInTheDocument();
  });

  it("podpowiedź jest PRZYCISKIEM z etykietą dostępności, nie samą ikoną", () => {
    render(<FieldLabel tip="Widoczna publicznie">Nazwa</FieldLabel>);
    expect(screen.getByRole("button", { name: "Widoczna publicznie" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("bez podpowiedzi nie dokłada przycisku do porządku fokusu", () => {
    render(<FieldLabel>Nazwa</FieldLabel>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("pusta podpowiedź i pusty dopisek nie renderują pustych węzłów", () => {
    const { container } = render(
      <FieldLabel tip={null} hint={null} className="niestandardowa">
        Nazwa
      </FieldLabel>,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(container.firstChild).toHaveClass("niestandardowa");
  });
});

describe("ProfileBadges", () => {
  it("renderuje listę odznak z etykietą po polsku", () => {
    render(<ProfileBadges badges={[PROFILE_BADGE_KINDS[0]]} />);
    expect(screen.getByRole("list", { name: "Odznaki profilowe" })).toBeInTheDocument();
  });

  it("etykieta listy podąża za językiem interfejsu", () => {
    h.language.current = "en";
    render(<ProfileBadges badges={[PROFILE_BADGE_KINDS[0]]} />);
    expect(screen.getByRole("list", { name: "Profile badges" })).toBeInTheDocument();
  });

  it("nie renderuje nic przy braku odznak", () => {
    const { container } = render(<ProfileBadges badges={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renderuje wszystkie kanoniczne odznaki naraz", () => {
    render(<ProfileBadges badges={[...PROFILE_BADGE_KINDS]} size="md" />);
    const list = screen.getByRole("list");
    expect(list.children.length).toBe(PROFILE_BADGE_KINDS.length);
  });
});

describe("AuthGate", () => {
  it("czeka na rozstrzygnięcie sesji, zamiast migać treścią lub odmową", () => {
    h.auth.loading = true;
    render(
      <AuthGate>
        <p>tajne</p>
      </AuthGate>,
    );
    expect(screen.getByLabelText("loading")).toBeInTheDocument();
    expect(screen.queryByText("tajne")).not.toBeInTheDocument();
  });

  it("bez sesji NIE renderuje treści chronionej", () => {
    render(
      <AuthGate fallbackTitle="Zaloguj się" fallbackBody="Sekcja profilu">
        <p>tajne</p>
      </AuthGate>,
    );
    expect(screen.queryByText("tajne")).not.toBeInTheDocument();
    // Tytuł nadpisany przez wołającego trafia do nagłówka ekranu odmowy,
    // a dodatkowy kontekst do stopki (obie kopie pochodzą z tego samego węzła).
    expect(screen.getByRole("heading", { name: "Zaloguj się" })).toBeInTheDocument();
    expect(screen.getAllByText("Sekcja profilu").length).toBeGreaterThan(0);
  });

  it("z sesją przepuszcza treść bez dodatkowego opakowania", () => {
    h.auth.session = { user: { id: "user-a" } };
    render(
      <AuthGate>
        <p>tajne</p>
      </AuthGate>,
    );
    expect(screen.getByText("tajne")).toBeInTheDocument();
  });
});
