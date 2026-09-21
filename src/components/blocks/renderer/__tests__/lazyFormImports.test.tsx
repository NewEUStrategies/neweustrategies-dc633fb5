import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { BlockType, BlocksDoc } from "@/lib/blocks/types";
import { BlocksRenderer } from "../../BlocksRenderer";

const loading = vi.hoisted(() => {
  let releaseNewsletter!: () => void;
  const newsletterReady = new Promise<void>((resolve) => {
    releaseNewsletter = resolve;
  });
  return { auth: 0, newsletter: 0, contact: 0, newsletterReady, releaseNewsletter };
});

// These stand-ins measure module evaluation and prop forwarding. Real contact
// HTML/hydration and existing auth/newsletter behavior have separate tests.
vi.mock("../../AuthFormBlocks", () => {
  loading.auth++;
  return {
    LoginFormView: ({ lang }: { lang: string }) => <form data-form="login" lang={lang} />,
    RegisterFormView: ({ lang }: { lang: string }) => <form data-form="register" lang={lang} />,
    LostPasswordFormView: ({ lang }: { lang: string }) => <form data-form="lost" lang={lang} />,
    ResetPasswordFormView: ({ lang }: { lang: string }) => <form data-form="reset" lang={lang} />,
  };
});
vi.mock("@/components/NewsletterForm", async () => {
  loading.newsletter++;
  await loading.newsletterReady;
  return {
    NewsletterForm: ({ lang }: { lang: string }) => <form data-form="newsletter" lang={lang} />,
  };
});
vi.mock("../../MarketingContactFormView", () => {
  loading.contact++;
  return {
    ContactFormView: ({ lang }: { lang: string }) => <form data-form="contact" lang={lang} />,
  };
});

function doc(type?: BlockType): BlocksDoc {
  return {
    version: 1,
    blocks: [
      { id: "before", type: "paragraph", data: { html: "Article before" } },
      ...(type ? [{ id: "form", type, data: {} }] : []),
      { id: "after", type: "paragraph", data: { html: "Article after" } },
    ],
  };
}

afterEach(cleanup);

describe("form code is requested only for present blocks", () => {
  it("does not evaluate any form module for a text article", () => {
    const { container } = render(<BlocksRenderer doc={doc()} />);
    expect(container.textContent).toContain("Article before");
    expect(loading.auth).toBe(0);
    expect(loading.newsletter).toBe(0);
    expect(loading.contact).toBe(0);
  });

  it("keeps both neighboring paragraphs visible while the newsletter chunk waits", async () => {
    const { container } = render(<BlocksRenderer doc={doc("newsletter")} lang="en" />);
    await waitFor(() => expect(loading.newsletter).toBe(1));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Article before");
    expect(container.textContent).toContain("Article after");
    await act(async () => loading.releaseNewsletter());
    await waitFor(() => expect(container.querySelector("form")).toHaveAttribute("lang", "en"));
    expect(loading.auth).toBe(0);
    expect(loading.contact).toBe(0);
  });

  it.each([
    ["login-form", "login"],
    ["register-form", "register"],
    ["lost-password-form", "lost"],
    ["reset-password-form", "reset"],
    ["contact-form", "contact"],
  ] as const)("resolves %s through the real block dispatcher", async (type, marker) => {
    const { container } = render(<BlocksRenderer doc={doc(type)} lang="en" />);
    await waitFor(() =>
      expect(container.querySelector("form")).toHaveAttribute("data-form", marker),
    );
    expect(container.querySelector("form")).toHaveAttribute("lang", "en");
    expect(container.textContent).toContain("Article before");
    expect(container.textContent).toContain("Article after");
    // All four auth variants reuse one evaluated module.
    expect(loading.auth).toBe(1);
  });
});
