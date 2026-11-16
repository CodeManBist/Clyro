import { describe, expect, it } from "vitest";
import { isSecretPath } from "../../src/security/secrets";

describe("SecretFilter", () => {
  it("blocks sensitive files and directories", () => {
    const protectedPaths = [
      ".env",
      ".env.local",
      "server.pem",
      "private.key",
      "certificate.p12",
      "id_rsa",
      "id_ed25519",
      ".npmrc",
      ".netrc",
      "credentials.json",
      ".aws/credentials",
      ".ssh/id_rsa",
      ".git/config",
      ".git-credentials",
      "nested/.env.production",
    ];

    for (const filePath of protectedPaths) {
      expect(isSecretPath(filePath), filePath).toBe(true);
    }
  });

  it("allows safe examples and ordinary source files", () => {
    const allowedPaths = [
      ".env.example",
      ".env.sample",
      "src/index.ts",
      "src/auth/login.ts",
      "README.md",
    ];

    for (const filePath of allowedPaths) {
      expect(isSecretPath(filePath), filePath).toBe(false);
    }
  });
});
