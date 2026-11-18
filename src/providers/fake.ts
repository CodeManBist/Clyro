
import type {
  GenerateRequest,
  GenerateResponse,
  ModelProvider,
} from "./types.js";

export class FakeProvider implements ModelProvider {
  readonly requests: GenerateRequest[] = [];

  private readonly responses: Array<GenerateResponse | Error>;

  constructor(responses: Array<GenerateResponse | Error> = []) {
    this.responses = [...responses];
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    this.requests.push(request);

    const response = this.responses.shift();

    if (response === undefined) {
      throw new Error("FakeProvider: No scripted response available");
    }

    if (response instanceof Error) throw response;
    return response;
  }
}
