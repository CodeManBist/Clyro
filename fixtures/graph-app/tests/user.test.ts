import { createUser } from "../src/auth/user.js";
import { describe, expect, it } from "vitest";

describe("fixture user", () => {
  it("creates a named user", () => {
    expect(createUser("fixture").name).toBe("fixture");
  });
});
