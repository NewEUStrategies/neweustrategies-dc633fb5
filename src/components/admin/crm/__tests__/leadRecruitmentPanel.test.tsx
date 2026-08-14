// Moduł „Rekrutacja" na karcie kontaktu CRM.
//
// Test blokuje regresję, którą ta zmiana naprawia: do tej pory zgłoszenie
// z /zatrudniamy było na karcie kontaktu NIEWIDOCZNE (rola, poziom, termin i CV
// leżały w `contact_messages.custom` / `crm_leads.aliases.custom`, których nie
// czytał żaden ekran). Sprawdzamy więc: rozwijalność sekcji, tłumaczenie slugów,
// podpisany link do pliku CV, link zewnętrzny, pusty stan i to, że zwykła
// wiadomość z formularza kontaktowego nie udaje zgłoszenia.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  signCvUrl: vi.fn(async (_p: string) => "https://signed.example.com/cv.pdf"),
  toastError: vi.fn(),
  windowOpen: vi.fn(),
}));

vi.mock("@/lib/careers/cvUpload", () => ({
  signCvUrl: (p: string) => h.signCvUrl(p),
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => h.toastError(m) } }));
// Panel linkuje do skrzynki rekrutacyjnej; router nie jest przedmiotem testu.
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

import { LeadRecruitmentPanel } from "../LeadRecruitmentPanel";
import { CAREERS_FORM_ID } from "@/lib/careers/recruitmentLayer";

const CV_PATH = "uploads/2026-08-14/2f9b3c14-77d1-4b0e-9d4e-8c2a1f6e0b55.pdf";

const APPLICATION = {
  id: "msg-1",
  form_id: CAREERS_FORM_ID,
  created_at: "2026-08-14T10:00:00.000Z",
  lang: "pl",
  message: "Chcę pracować nad agendą europejską.",
  custom: {
    department: "analysis",
    role: "analyst_economy",
    role_label: "Analityk gospodarczy",
    seniority: "mid",
    start: "month",
    linkedin: "https://linkedin.com/in/kandydat",
    cv_path: CV_PATH,
    cv_file_name: "cv-kandydat.pdf",
  },
};

beforeEach(() => {
  h.signCvUrl.mockClear();
  h.toastError.mockClear();
  h.windowOpen.mockClear();
  vi.stubGlobal("open", h.windowOpen);
});

describe("LeadRecruitmentPanel", () => {
  it("pokazuje zgłoszenie z rolą, przetłumaczonymi slugami i uzasadnieniem", () => {
    render(<LeadRecruitmentPanel aliases={{}} messages={[APPLICATION]} lang="pl" />);
    expect(screen.getByText("Analityk gospodarczy")).toBeInTheDocument();
    // Slugi „analysis" / „mid" / „month" muszą być tekstem, nie kodem enuma.
    expect(screen.getByText("Analizy")).toBeInTheDocument();
    expect(screen.getByText("Specjalista")).toBeInTheDocument();
    expect(screen.getByText("W ciągu miesiąca")).toBeInTheDocument();
    expect(screen.getByText("Chcę pracować nad agendą europejską.")).toBeInTheDocument();
  });

  it("otwiera plik CV podpisanym linkiem z prywatnego bucketu", async () => {
    render(<LeadRecruitmentPanel aliases={{}} messages={[APPLICATION]} lang="pl" />);
    fireEvent.click(screen.getByRole("button", { name: /cv-kandydat\.pdf/ }));
    await screen.findByText("Analityk gospodarczy");
    expect(h.signCvUrl).toHaveBeenCalledWith(CV_PATH);
  });

  it("prowadzi do linku zewnętrznego, gdy kandydat nie wgrał pliku", () => {
    render(
      <LeadRecruitmentPanel
        aliases={{}}
        lang="pl"
        messages={[
          {
            ...APPLICATION,
            custom: { ...APPLICATION.custom, cv_path: "", cv_url: "drive.example.com/cv" },
          },
        ]}
      />,
    );
    const link = screen.getByRole("link", { name: /CV \(link zewnętrzny\)/ });
    // Bez normalizacji schematu href byłby URL-em relatywnym w panelu admina.
    expect(link).toHaveAttribute("href", "https://drive.example.com/cv");
  });

  it("jest zwinięty i pusty dla kontaktu, który nie aplikował", () => {
    render(<LeadRecruitmentPanel aliases={{ sources: ["newsletter"] }} messages={[]} lang="pl" />);
    const toggle = screen.getByRole("button", { name: /Rekrutacja/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(
      screen.getByText("Ten kontakt nie aplikował przez stronę /zatrudniamy."),
    ).toBeInTheDocument();
  });

  it("ignoruje wiadomości z innych formularzy", () => {
    render(
      <LeadRecruitmentPanel
        aliases={{}}
        lang="pl"
        messages={[
          {
            id: "msg-9",
            form_id: "contact",
            created_at: "2026-08-14T10:00:00.000Z",
            message: "Pytanie o konferencję.",
            custom: { role_label: "Nie-rola" },
          },
        ]}
      />,
    );
    expect(screen.queryByText("Nie-rola")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rekrutacja/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("pokazuje historię z aliasów, gdy zgłoszenia nie ma już w skrzynce", () => {
    render(
      <LeadRecruitmentPanel
        aliases={{ custom: { role_label: ["Redaktor prowadzący"] } }}
        messages={[]}
        lang="pl"
      />,
    );
    expect(screen.getByText("Historia dopasowań")).toBeInTheDocument();
    expect(screen.getByText("Redaktor prowadzący")).toBeInTheDocument();
  });

  it("mówi po angielsku, gdy panel jest w EN", () => {
    render(<LeadRecruitmentPanel aliases={{}} messages={[APPLICATION]} lang="en" />);
    expect(screen.getByRole("button", { name: /Recruitment/ })).toBeInTheDocument();
    expect(screen.getByText("Research")).toBeInTheDocument();
    expect(screen.getByText("Mid-level")).toBeInTheDocument();
  });
});
