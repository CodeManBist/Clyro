import { describe, expect, it } from "vitest";
import { redactSecrets } from "../../src/security/redact.js";

describe("Redactor", () => {
  it("redacts Google API keys", () => {
    const result = redactSecrets(
      "key: AIzaSyDUMMY123456789012345678901234567",
    );

    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("AIzaSyDUMMY");
  });

  it("redacts GitHub tokens", () => {
    const result = redactSecrets(
      "token: ghp_abcdefghijklmnopqrstuvwxyz123456",
    );

    expect(result).toContain("[REDACTED]");
  });

  it("redacts bearer tokens", () => {
    const result = redactSecrets(
      "Authorization: Bearer secret-token-123 and Bearer second-secret",
    );

    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("second-secret");
  });

  it("redacts environment-style secret assignments", () => {
    const result = redactSecrets(
      "DATABASE_PASSWORD=my-secret-password",
    );

    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("my-secret-password");
  });

  it("preserves ordinary text", () => {
    const result = redactSecrets(
      "This is a normal TypeScript function.",
    );

    expect(result).toBe(
      "This is a normal TypeScript function.",
    );
  });

  it("redacts AWS keys, PEM blocks, credential URLs, GitHub variants, and multiple values", () => {
    const result = redactSecrets([
      "AKIA1234567890ABCDEF",
      "ASIA1234567890ABCDEF",
      "gho_secretvalue github_pat_exampletoken",
      "https://user:password@example.test/path",
      "-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----",
    ].join(" "));
    expect(result).not.toMatch(/AKIA|ASIA|gho_secretvalue|github_pat_exampletoken|user:password|private-material/);
    expect(result.match(/\[REDACTED\]/g)).toHaveLength(6);
  });

  it("redacts the exact configured Gemini key", () => {
    const previous = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "local-gemini-secret-value";
    try {
      expect(redactSecrets("key=local-gemini-secret-value")).toBe("key=[REDACTED]");
    } finally {
      if (previous === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = previous;
    }
  });
});
