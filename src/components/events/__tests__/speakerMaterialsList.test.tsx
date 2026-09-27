// Materiały prelegenta w dialogu profilu na stronie wydarzenia.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW:
//   * organizator klika „Opublikuj", a dialog nie pokazuje niczego - albo
//     pokazuje materiały INNEGO prelegenta tego wydarzenia (jedno zapytanie na
//     wydarzenie, filtr po nakładce jest tutaj);
//   * adres wpisany przez prelegenta dostaje dostęp do okna strony (bez
//     `noopener noreferrer`);
//   * pusty nagłówek „Materiały" nad niczym, albo błąd udający brak materiałów;
//   * po zalogowaniu dialog trzyma migawkę gościa (klucz bez widza).
import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axeViolations } from "@/test/axe";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  userId: null as string | null,
}));

vi.mock("react-i18next", async () => {
  const { translateKey } = await import("@/test/i18nStub");
  return {
    useTranslation: () => ({ t: translateKey, i18n: { language: "pl" } }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.userId === null ? null : { id: h.userId } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: brak atrapy RPC");
      return h.rpc.rpc(name, args);
    },
  },
}));

const { SpeakerMaterialsList } = await import("@/components/events/SpeakerMaterialsList");

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    speaker_profile_id: "sp1",
    session_id: null,
    kind: "slides",
    title_pl: "Slajdy",
    title_en: "",
    url: "https://example.org/slajdy.pdf",
    visibility: "public",
    ...overrides,
  };
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test");
  return h.rpc;
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.userId = null;
});

describe("SpeakerMaterialsList", () => {
  it("pokazuje WYŁĄCZNIE materiały tej osoby, z rodzajem i bezpiecznym odnośnikiem", async () => {
    stub().setData("event_speaker_materials_public", [
      row(),
      row({ id: "m2", kind: "video", title_pl: "Nagranie", visibility: "registered" }),
      row({ id: "m3", speaker_profile_id: "sp-inny", title_pl: "Cudzy" }),
    ]);
    const { container } = renderWithQueryClient(
      <SpeakerMaterialsList eventId="e1" speakerProfileId="sp1" lang="pl" />,
    );
    const link = await screen.findByRole("link", { name: /Slajdy/ });
    expect(link).toHaveAttribute("href", "https://example.org/slajdy.pdf");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(screen.getByRole("link", { name: /Nagranie/ })).toBeInTheDocument();
    expect(screen.queryByText("Cudzy")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "eventFront.speakers.materials.heading(lng=pl)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("eventFront.speakers.materials.kinds.slides(lng=pl)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("eventFront.speakers.materials.kinds.video(lng=pl)"),
    ).toBeInTheDocument();
    // Etykieta „dla zapisanych" tylko przy materiale z taką widocznością.
    expect(
      screen.getAllByText("eventFront.speakers.materials.registeredOnly(lng=pl)"),
    ).toHaveLength(1);
    expect(stub().lastCall("event_speaker_materials_public")?.arg("p_event_id")).toBe("e1");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("tytuł w języku dialogu, a przy pustym - w drugim języku", async () => {
    stub().setData("event_speaker_materials_public", [
      row({ title_pl: "Tylko po polsku", title_en: "" }),
      row({ id: "m2", title_pl: "Po polsku", title_en: "In English" }),
    ]);
    renderWithQueryClient(<SpeakerMaterialsList eventId="e1" speakerProfileId="sp1" lang="en" />);
    expect(await screen.findByText("Tylko po polsku")).toBeInTheDocument();
    expect(screen.getByText("In English")).toBeInTheDocument();
    expect(screen.queryByText("Po polsku")).toBeNull();
    expect(screen.getAllByText("eventFront.speakers.card.opensInNewTab(lng=en)")).toHaveLength(2);
  });

  it("bez materiałów tej osoby nie rysuje niczego (także podczas wczytywania)", async () => {
    stub().setData("event_speaker_materials_public", [row({ speaker_profile_id: "sp-inny" })]);
    const { container, queryClient } = renderWithQueryClient(
      <SpeakerMaterialsList eventId="e1" speakerProfileId="sp1" lang="pl" />,
    );
    expect(container).toBeEmptyDOMElement();
    await waitFor(() =>
      expect(queryClient.getQueryState(["event-speaker-materials", "e1", "anon"])?.status).toBe(
        "success",
      ),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("błąd odczytu mówi o sobie, zamiast udawać brak materiałów", async () => {
    stub().setError("event_speaker_materials_public", "boom");
    renderWithQueryClient(<SpeakerMaterialsList eventId="e1" speakerProfileId="sp1" lang="pl" />);
    expect(
      await screen.findByText("eventFront.speakers.materials.loadFailed(lng=pl)"),
    ).toHaveAttribute("role", "status");
  });

  it("zalogowany widz ma własny wpis cache (materiały dla zapisanych)", async () => {
    h.userId = "u1";
    stub().setData("event_speaker_materials_public", [row()]);
    const { queryClient } = renderWithQueryClient(
      <SpeakerMaterialsList eventId="e1" speakerProfileId="sp1" lang="pl" />,
    );
    await screen.findByRole("link", { name: /Slajdy/ });
    expect(queryClient.getQueryData(["event-speaker-materials", "e1", "u1"])).toHaveLength(1);
    expect(queryClient.getQueryData(["event-speaker-materials", "e1", "anon"])).toBeUndefined();
  });
});
