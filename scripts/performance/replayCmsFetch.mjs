import { cmsFixtureResponse } from "./cmsFixture.ts";
import { isFixtureBackend } from "./homeFixture.ts";
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (isFixtureBackend(request.url)) return cmsFixtureResponse(request);
  return realFetch(input, init);
};
