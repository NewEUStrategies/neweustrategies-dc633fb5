// Tymczasowa strona deweloperska do weryfikacji wyglądu etykiet działów klubu.
// Usunąć po zatwierdzeniu wizualnym.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ClubGroupBar, ClubGroupTree } from "@/components/clubs/molecules/ClubGroupTree";
import type { ClubGroupRow } from "@/lib/clubs/types";

const MOCK_GROUPS = [
  {
    id: "general",
    slug: "general",
    name_pl: "Strefa Ogólna",
    name_en: "General",
    icon: "home",
    accent_color: null,
    can_read: true,
    thread_count: 0,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
  {
    id: "main-disc",
    slug: "general-main-disc",
    name_pl: "Dyskusje główne",
    name_en: "Main discussions",
    icon: null,
    accent_color: null,
    can_read: true,
    thread_count: 12,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
  {
    id: "announcements",
    slug: "general-announcements",
    name_pl: "Ogłoszenia",
    name_en: "Announcements",
    icon: null,
    accent_color: null,
    can_read: true,
    thread_count: 4,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
  {
    id: "workshops",
    slug: "workshops",
    name_pl: "Warsztaty",
    name_en: "Workshops",
    icon: "pen-tool",
    accent_color: "#e85d3a",
    can_read: true,
    thread_count: 0,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
  {
    id: "ui-design",
    slug: "workshops-ui-design",
    name_pl: "Projektowanie UI",
    name_en: "UI Design",
    icon: null,
    accent_color: "#e85d3a",
    can_read: true,
    thread_count: 0,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
  {
    id: "css-code",
    slug: "workshops-css-code",
    name_pl: "Kodowanie CSS",
    name_en: "CSS Coding",
    icon: null,
    accent_color: "#e85d3a",
    can_read: true,
    thread_count: 3,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
  {
    id: "resources",
    slug: "resources",
    name_pl: "Zasoby",
    name_en: "Resources",
    icon: "archive",
    accent_color: "#4f46e5",
    can_read: true,
    thread_count: 0,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
  {
    id: "library",
    slug: "resources-library",
    name_pl: "Biblioteka plików",
    name_en: "File library",
    icon: null,
    accent_color: "#4f46e5",
    can_read: true,
    thread_count: 7,
    parent_id: null,
    description_pl: null,
    description_en: null,
  },
] as unknown as readonly ClubGroupRow[];

function DevClubLabelsPage() {
  const [activeGroupId, setActiveGroupId] = useState<string | null>("css-code");
  const [isPl] = useState(true);

  return (
    <div className="min-h-screen bg-background p-6">
      <h1 className="mb-8 text-lg font-bold">Club labels preview</h1>

      <div className="mb-8 max-w-sm rounded-xl border border-border bg-card p-4 shadow-sm">
        <ClubGroupTree
          groups={MOCK_GROUPS}
          activeGroupId={activeGroupId}
          onGroupChange={setActiveGroupId}
          isPl={isPl}
        />
      </div>

      <div className="max-w-md rounded-xl border border-border bg-card p-4 shadow-sm">
        <ClubGroupBar
          groups={MOCK_GROUPS}
          activeGroupId={activeGroupId}
          onGroupChange={setActiveGroupId}
          isPl={isPl}
        />
      </div>
    </div>
  );
}

export const Route = createFileRoute("/dev/club-labels")({
  component: DevClubLabelsPage,
});
