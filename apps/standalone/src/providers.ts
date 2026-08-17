import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";

export interface GenerationProvider {
  generate(prompt: string): Promise<string>;
}

export interface EmbeddingProvider {
  model: string;
  embedDocuments(values: string[]): Promise<number[][]>;
  embedQuery(value: string): Promise<number[]>;
}

const anthropicProviderOptionsSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

export function createAnthropicGenerationProvider(
  rawOptions: z.input<typeof anthropicProviderOptionsSchema>,
): GenerationProvider {
  const options = anthropicProviderOptionsSchema.parse(rawOptions);
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  return {
    async generate(prompt) {
      const result = await generateText({ model: anthropic(options.model), prompt });
      return result.text;
    },
  };
}

const embeddingProviderOptionsSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
  url: z.url().default("https://api.voyageai.com/v1/embeddings"),
  fetch: z.custom<typeof fetch>().optional(),
});

const embeddingResponseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().optional(), embedding: z.array(z.number()) })),
});

export function createHttpEmbeddingProvider(
  rawOptions: z.input<typeof embeddingProviderOptionsSchema>,
): EmbeddingProvider {
  const options = embeddingProviderOptionsSchema.parse(rawOptions);
  const fetchImpl = options.fetch ?? fetch;

  const embed = async (values: string[], inputType: "document" | "query") => {
    const response = await fetchImpl(options.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ input: values, model: options.model, input_type: inputType }),
    });
    if (!response.ok) throw new Error(`embedding provider failed with status ${response.status}`);
    const payload = embeddingResponseSchema.parse(await response.json());
    return payload.data
      .toSorted((left, right) => (left.index ?? 0) - (right.index ?? 0))
      .map((item) => item.embedding);
  };

  return {
    model: options.model,
    embedDocuments: (values) => embed(values, "document"),
    async embedQuery(value) {
      const [embedding] = await embed([value], "query");
      if (!embedding) throw new Error("embedding provider returned no query vector");
      return embedding;
    },
  };
}
