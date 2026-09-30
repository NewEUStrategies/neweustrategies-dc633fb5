import { fixtureResponse, isFixtureBackend } from "./homeFixture.ts";

// Node --import test harness. No application conditional, new route or mock
// backend can enter a deployed build. The same artifact is tested before/after.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (isFixtureBackend(request.url)) {
    // Deliberately miss the 600 ms loader deadline without hanging the backend.
    // The first-fold section must still stream real HTML and hydrate intact.
    const slowPosts =
      process.env.NES_PERFORMANCE_CASE === "slow-first-fold" &&
      new URL(request.url).pathname === "/rest/v1/posts";
    return fixtureResponse(request, { delayMs: slowPosts ? 900 : 40 });
  }
  return realFetch(input, init);
};
