// Click-to-Tweet (X) styled quote with deep-link share.
interface Props {
  text: string;
  via?: string;
  hashtags?: string;
  url?: string;
  lang?: "pl" | "en";
}

export function XQuoteShare({ text, via, hashtags, url, lang = "pl" }: Props) {
  const L = lang === "pl" ? "Udostępnij na X" : "Share on X";
  const params = new URLSearchParams();
  params.set("text", text);
  if (via) params.set("via", via.replace(/^@/, ""));
  if (hashtags) params.set("hashtags", hashtags.replace(/\s+/g, ""));
  if (url) params.set("url", url);
  const href = `https://twitter.com/intent/tweet?${params.toString()}`;

  return (
    <figure className="not-prose my-6 rounded-xl border border-border bg-card p-5 relative">
      <svg viewBox="0 0 24 24" aria-hidden="true" className="absolute top-3 right-3 w-5 h-5 text-foreground/40 fill-current">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      <blockquote className="text-lg md:text-xl font-semibold leading-snug pr-8 mb-3">
        "{text}"
      </blockquote>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className="w-4 h-4 fill-current">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        {L}
      </a>
    </figure>
  );
}
