import type { ToolErrorCode } from "./types.js";

export class ToolFailure extends Error {
  constructor(public readonly code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolFailure";
  }
}

