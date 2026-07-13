// Kanoniczne źródło bio to profiles.bio_pl/bio_en (migracje 20260713140000 +
// 20260713150000). author_profiles.bio_* pozostaje wyłącznie jako fallback dla
// kont, które nigdy nie zapisały bio w profiles (legacy). Ta reguła jest
// współdzielona przez widget BIO autora we wpisach i kartę autora.
export function preferCanonicalBio(
  profileBio: string | null | undefined,
  legacyOverlayBio: string | null | undefined,
): string | null {
  if (profileBio && profileBio.trim() !== "") return profileBio;
  if (legacyOverlayBio && legacyOverlayBio.trim() !== "") return legacyOverlayBio;
  return null;
}
