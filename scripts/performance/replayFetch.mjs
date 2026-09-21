import { fixtureResponse, isFixtureBackend } from "./homeFixture.ts";

// Node --import test harness. No application conditional, new route or mock
// backend can enter a deployed build. The same artifact is tested before/after.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (isFixtureBackend(request.url)) {
    return fixtureResponse(request, { delayMs: 40 });
  }
  return realFetch(input, init);
};
