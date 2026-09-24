import { describe, expect, it } from "vitest";
import {
  expandInlineEntities,
  inlineEntityAvatarHtml,
  inlineEntityMarkup,
  INLINE_ENTITY_TRIGGER_ATTR,
} from "../expand";
import { company, person, token } from "./fixtures";

const registry = { [company().id]: company(), [person().id]: person() };

describe("expandInlineEntities", () => {
  it("returns input untouched when there is nothing to expand", () => {
    expect(expandInlineEntities("", registry)).toBe("");
    expect(expandInlineEntities("<p>plain</p>", registry)).toBe("<p>plain</p>");
  });

  it("replaces a reference with an interactive trigger", () => {
    const html = expandInlineEntities(`<p>Brief ${token(person())} ruled.</p>`, registry);
    expect(html).toContain(`${INLINE_ENTITY_TRIGGER_ATTR}="ie_maya0001"`);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">Maya Chen</span></button></span>");
    expect(html.startsWith("<p>Brief <span")).toBe(true);
    expect(html.endsWith(" ruled.</p>")).toBe(true);
  });

  it("uses the registry name, not the stale fallback text", () => {
    const stale = `<span data-nes-entity="ie_acme0001" data-nes-entity-kind="company">Old name</span>`;
    const html = expandInlineEntities(stale, registry);
    expect(html).toContain("Acme Energy");
    expect(html).not.toContain("Old name");
  });

  it("keeps unknown references readable", () => {
    const unknown = `<p><span data-nes-entity="ie_nope0001">Ghost</span></p>`;
    expect(expandInlineEntities(unknown, registry)).toBe(unknown);
  });

  it("renders a non-interactive variant inside links", () => {
    const html = expandInlineEntities(`<a href="/x">see ${token(company())}</a>`, registry);
    expect(html).not.toContain("<button");
    expect(html).toContain('data-nes-ie="ie_acme0001"');
    const after = expandInlineEntities(`<a href="/x">x</a> ${token(company())}`, registry);
    expect(after).toContain("<button");
  });

  it("swallows nested spans inside a pasted reference", () => {
    const pasted = `<span data-nes-entity="ie_acme0001"><span class="x">Acme</span> Energy</span>!`;
    const html = expandInlineEntities(pasted, registry);
    expect(html.endsWith("</button></span>!")).toBe(true);
    expect(html).not.toContain('class="x"');
  });

  it("leaves a broken, unclosed reference as it was", () => {
    const broken = `<span data-nes-entity="ie_acme0001">Acme`;
    expect(expandInlineEntities(broken, registry)).toBe(broken);
  });

  it("escapes names and attribute values", () => {
    const evil = company({ name: `"><img src=x onerror=alert(1)>` });
    const html = inlineEntityMarkup(evil, true);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(`"&gt;&lt;img src=x onerror=alert(1)&gt;`);
  });

  it("is deterministic (SSR and client produce identical markup)", () => {
    const input = `<p>${token(company())} and ${token(person())}</p>`;
    expect(expandInlineEntities(input, registry)).toBe(expandInlineEntities(input, registry));
  });
});

describe("inlineEntityAvatarHtml", () => {
  it("renders a lazily loaded, sized image with 6px rounding", () => {
    const html = inlineEntityAvatarHtml(company());
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('width="24" height="24"');
    expect(html).toContain("rounded-[6px]");
    expect(html).toContain('alt=""');
  });

  it("builds a server-scaled srcset for storage images", () => {
    const html = inlineEntityAvatarHtml(
      company({
        image: { src: "https://x.supabase.co/storage/v1/object/public/media/t/u/a.webp" },
      }),
    );
    expect(html).toContain("/storage/v1/render/image/public/media/t/u/a.webp");
    expect(html).toContain(" 2x");
  });

  it("falls back to initials without an image", () => {
    const html = inlineEntityAvatarHtml(person());
    expect(html).toContain(">MC</span>");
    expect(html).toContain('aria-hidden="true"');
  });
});
