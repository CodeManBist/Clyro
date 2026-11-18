import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toGeminiFunctionDeclarations, toGeminiJsonSchema, zodToJsonSchema } from "../../src/providers/schema.js";

describe("Gemini function schema conversion", () => {
  it("preserves object properties, required fields, nested objects, arrays and enums", () => {
    const json = zodToJsonSchema(z.object({
      path: z.string().describe("Repository path"),
      mode: z.enum(["read", "write"]),
      options: z.object({ recursive: z.boolean() }),
      tags: z.array(z.string()),
    }));
    const declaration = toGeminiFunctionDeclarations([{ name: "inspect", description: "Inspect", schema: json }])[0];
    expect(declaration).toMatchObject({ name: "inspect", description: "Inspect" });
    expect(declaration.parametersJsonSchema).toMatchObject({
      type: "object",
      required: ["path", "mode", "options", "tags"],
      properties: {
        path: { type: "string", description: "Repository path" },
        mode: { type: "string", enum: ["read", "write"] },
        options: { type: "object", properties: { recursive: { type: "boolean" } } },
        tags: { type: "array", items: { type: "string" } },
      },
    });
  });

  it("removes non-validating metadata while retaining Gemini supported schema fields", () => {
    expect(toGeminiJsonSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object", title: "Tool", properties: { count: { type: "integer", minimum: 1 } },
    })).toEqual({ type: "object", properties: { count: { type: "integer", minimum: 1 } } });
  });

  it("rejects unsupported constraints instead of silently weakening validation", () => {
    expect(() => toGeminiJsonSchema({ type: "object", properties: { value: { type: "string", patternProperties: {} } } }))
      .toThrow(/Unsupported JSON Schema keyword "patternProperties"/);
  });

  it("validates model arguments using the source Zod schema", () => {
    const schema = z.object({ path: z.string().min(1) });
    expect(schema.safeParse({ path: "src/index.ts" }).success).toBe(true);
    expect(schema.safeParse({ path: "" }).success).toBe(false);
    expect(schema.safeParse({ path: 7 }).success).toBe(false);
  });
});
