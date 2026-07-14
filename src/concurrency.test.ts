import { describe, expect, it, vi } from "vitest";
import { recordCapturedError, consumeLastCapturedError } from "./lib/error-capture";

describe("Error Capture Concurrency", () => {
  it("fails when two requests capture errors concurrently", async () => {
    const error1 = new Error("Error 1");
    const error2 = new Error("Error 2");

    // Simulate Request 1 starting
    recordCapturedError(error1);
    
    // Simulate Request 2 starting and capturing an error before Request 1 consumes it
    recordCapturedError(error2);

    // Request 1 tries to consume its error
    const captured1 = consumeLastCapturedError();
    // Request 2 tries to consume its error
    const captured2 = consumeLastCapturedError();

    // THIS WILL FAIL with the current global variable implementation
    // captured1 will be error2, and captured2 will be undefined.
    expect(captured1).toBe(error1);
    expect(captured2).toBe(error2);
  });
});
