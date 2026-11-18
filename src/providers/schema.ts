import { z } from "zod";
import type { ToolDeclaration } from "./types.js";

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  "$defs", "$ref", "type", "properties", "required", "items", "enum",
  "description", "format", "nullable", "minimum", "maximum", "minItems",
  "maxItems", "minLength", "maxLength", "minProperties", "maxProperties",
  "pattern", "additionalProperties", "propertyOrdering", "anyOf", "oneOf",
]);
const NON_VALIDATING_KEYS = new Set(["$schema", "$id", "$comment", "title", "default", "examples", "example"]);

/** Convert a Zod 4 input schema through its first-party JSON Schema exporter. */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" });
  if (!isRecord(json)) throw new Error("Tool input schema must be a JSON Schema object");
  return json;
}

/** Remove JSON Schema annotations Gemini ignores and reject constraints it cannot represent. */
export function toGeminiJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return cleanSchema(schema, "tool parameters") as Record<string, unknown>;
}

export function toGeminiFunctionDeclarations(tools: ToolDeclaration[]): GeminiFunctionDeclaration[] {
  return tools.map((tool) => {
    const parametersJsonSchema = toGeminiJsonSchema(tool.schema);
    if (parametersJsonSchema.type !== "object") {
      throw new Error(`Tool "${tool.name}" schema must have an object at its root`);
    }
    return {
      name: tool.name,
      description: tool.description,
      parametersJsonSchema,
    };
  });
}

function cleanSchema(value: unknown, path: string): unknown {
  if (Array.isArray(value)) return value.map((item, index) => cleanSchema(item, `${path}[${index}]`));
  if (!isRecord(value)) return value;

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (NON_VALIDATING_KEYS.has(key)) continue;
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      throw new Error(`Unsupported JSON Schema keyword "${key}" at ${path}; validate it outside Gemini or simplify the schema`);
    }
    if ((key === "properties" || key === "$defs") && isRecord(child)) {
      result[key] = Object.fromEntries(
        Object.entries(child).map(([name, nested]) => [name, cleanSchema(nested, `${path}.${key}.${name}`)]),
      );
    } else {
      result[key] = cleanSchema(child, `${path}.${key}`);
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
