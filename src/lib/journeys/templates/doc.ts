// Budulec szablonów: węzły, krawędzie i bloki EmailDoc bez powtarzania
// kształtu w czternastu plikach. Każdy blok ma stabilny identyfikator (edytor
// S8 adresuje bloki po `id`).
import {
  DEFAULT_EMAIL_DOC_STYLE,
  type EmailBlock,
  type EmailButtonBlock,
  type EmailDoc,
  type EmailFooterNoteBlock,
  type EmailHeadingBlock,
  type EmailParagraphBlock,
} from "@/lib/newsletter/emailDoc";
import type { JourneyEdge, JourneyNode } from "../graph";
import type { JourneyEdgeBranch, JourneyNodeType } from "../nodeTypes";

export function node(id: string, type: JourneyNodeType, params: unknown = {}): JourneyNode {
  return { id, type, params };
}

export function edge(from: string, to: string, branch: JourneyEdgeBranch = "next"): JourneyEdge {
  return { from, to, branch };
}

/** Łańcuch `next`: a -> b -> c. */
export function chain(...ids: string[]): JourneyEdge[] {
  return ids.slice(1).map((id, i) => edge(ids[i], id));
}

export function heading(id: string, pl: string, en: string): EmailHeadingBlock {
  return { id, type: "heading", text: { pl, en }, level: 1, align: "left" };
}

export function paragraph(id: string, pl: string, en: string): EmailParagraphBlock {
  return { id, type: "paragraph", html: { pl, en }, align: "left" };
}

export function button(id: string, pl: string, en: string, url: string): EmailButtonBlock {
  return { id, type: "button", label: { pl, en }, url, align: "left" };
}

export function footnote(id: string, pl: string, en: string): EmailFooterNoteBlock {
  return { id, type: "footer-note", html: { pl, en } };
}

export function emailDoc(...blocks: EmailBlock[]): EmailDoc {
  return { version: 1, blocks, style: { ...DEFAULT_EMAIL_DOC_STYLE } };
}

/** Minuty - czytelniejsze czekania w grafach. */
export const HOUR = 60;
export const DAY = 24 * HOUR;
