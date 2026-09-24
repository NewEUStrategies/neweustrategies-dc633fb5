// Wspólne fixture'y encji inline dla testów warstwy czystej, renderera i edytora.
import type { Block, BlocksDoc } from "@/lib/blocks/types";
import type { InlineCompanyEntity, InlinePersonEntity } from "../model";
import { inlineEntityTokenHtml, withInlineEntities } from "../registry";

export function company(overrides: Partial<InlineCompanyEntity> = {}): InlineCompanyEntity {
  return {
    id: "ie_acme0001",
    kind: "company",
    name: "Acme Energy",
    country: { code: "PL", pl: "Polska", en: "Poland" },
    industry: { pl: "Energetyka", en: "Energy" },
    specialization: { pl: "Magazyny energii", en: "Energy storage" },
    website: "https://acme.example.com/",
    socials: { linkedin: "https://www.linkedin.com/company/acme/" },
    image: { src: "https://cdn.example.com/acme.png" },
    source: { type: "crm", id: "11111111-1111-4111-8111-111111111111", syncedAt: "2026-09-01" },
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function person(overrides: Partial<InlinePersonEntity> = {}): InlinePersonEntity {
  return {
    id: "ie_maya0001",
    kind: "person",
    firstName: "Maya",
    lastName: "Chen",
    position: { pl: "Dyrektorka produktu", en: "Product Lead" },
    company: "Northwind",
    website: "https://maya.example.com/",
    socials: { x: "https://x.com/maya" },
    image: null,
    source: { type: "manual" },
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

export function paragraph(id: string, html: string): Block {
  return { id, type: "paragraph", data: { html } };
}

export function docWith(
  blocks: Block[],
  entities: Array<InlineCompanyEntity | InlinePersonEntity>,
): BlocksDoc {
  const registry = Object.fromEntries(entities.map((e) => [e.id, e]));
  return withInlineEntities({ version: 1, blocks }, registry);
}

export const token = inlineEntityTokenHtml;
