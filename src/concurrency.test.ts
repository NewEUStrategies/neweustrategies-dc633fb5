import { describe, expect, it } from "vitest";
import { recordCapturedError, consumeLastCapturedError } from "./lib/error-capture";

describe("Error Capture Concurrency", () => {
  it("succeeds when two requests capture errors concurrently using Request identity", async () => {
    const req1 = new Request("http://localhost/1");
    const req2 = new Request("http://localhost/2");
    const error1 = new Error("Error 1");
    const error2 = new Error("Error 2");

    // Simulate Request 1 starting
    recordCapturedError(error1, req1);
    
    // Simulate Request 2 starting and capturing an error
    recordCapturedError(error2, req2);

    // Request 1 tries to consume its error
    const captured1 = consumeLastCapturedError(req1);
    // Request 2 tries to consume its error
    const captured2 = consumeLastCapturedError(req2);

    // This should now SUCCEED
    expect(captured1).toBe(error1);
    expect(captured2).toBe(error2);
  });

  it("still works with global fallback if no request is provided", () => {
    const error = new Error("Global Error");
    recordCapturedError(error);
    expect(consumeLastCapturedError()).toBe(error);
  });

  it("prioritizes request-specific error over global", () => {
    const req = new Request("http://localhost/");
    const error1 = new Error("Global");
    const error2 = new Error("Specific");
    
    recordCapturedError(error1);
    recordCapturedError(error2, req);
    
    expect(consumeLastCapturedError(req)).toBe(error2);
    expect(consumeLastCapturedError()).toBe(error1);
  });
});
