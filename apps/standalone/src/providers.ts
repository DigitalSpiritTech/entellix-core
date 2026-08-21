/**
 * Adapts generation and embedding providers to the core engine ports.
 *
 * Inputs: Imported dependencies and values passed to the module's documented functions.
 * Outputs: Exported types, values, and behavior provided by the module.
 * Errors: Functions document validation, dependency, and runtime errors individually.
 *
 * @packageDocumentation
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { z } from "zod";

export interface GenerationProvider {
  /**
   * Executes generate.
   *
   * @param prompt - Value supplied for `prompt`.
   * @returns The result produced by `generate`.
   * @throws Errors raised by validation or dependent operations.
   */
  generate(prompt: string): Promise<string>;
}

export interface EmbeddingProvider {
  model: string;
  /**
   * Executes embed documents.
   *
   * @param values - Value supplied for `values`.
   * @returns The result produced by `embedDocuments`.
   * @throws Errors raised by validation or dependent operations.
   */
  embedDocuments(values: string[]): Promise<number[][]>;
  /**
   * Executes embed query.
   *
   * @param value - Value supplied for `value`.
   * @returns The result produced by `embedQuery`.
   * @throws Errors raised by validation or dependent operations.
   */
  embedQuery(value: string): Promise<number[]>;
}

const anthropicProviderOptionsSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

/**
 * Creates anthropic generation provider.
 *
 * @param rawOptions - Value supplied for `rawOptions`.
 * @returns The result produced by `createAnthropicGenerationProvider`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createAnthropicGenerationProvider(
  rawOptions: z.input<typeof anthropicProviderOptionsSchema>,
): GenerationProvider {
  const options = anthropicProviderOptionsSchema.parse(rawOptions);
  const anthropic = createAnthropic({ apiKey: options.apiKey });
  return {
    /**
     * Executes generate.
     *
     * @param prompt - Value supplied for `prompt`.
     * @returns The result produced by `generate`.
     * @throws Errors raised by validation or dependent operations.
     */
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

/**
 * Creates http embedding provider.
 *
 * @param rawOptions - Value supplied for `rawOptions`.
 * @returns The result produced by `createHttpEmbeddingProvider`.
 * @throws Errors raised by validation or dependent operations.
 */
export function createHttpEmbeddingProvider(
  rawOptions: z.input<typeof embeddingProviderOptionsSchema>,
): EmbeddingProvider {
  const options = embeddingProviderOptionsSchema.parse(rawOptions);
  const fetchImpl = options.fetch ?? fetch;

  /**
   * Executes embed.
   *
   * @param values - Value supplied for `values`.
   * @param inputType - Value supplied for `inputType`.
   * @returns The result produced by `embed`.
   * @throws Errors raised by validation or dependent operations.
   */
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
    /**
     * Executes embed documents.
     *
     * @param values - Value supplied for `values`.
     * @returns The result produced by `embedDocuments`.
     * @throws Errors raised by validation or dependent operations.
     */
    embedDocuments: (values) => embed(values, "document"),
    /**
     * Executes embed query.
     *
     * @param value - Value supplied for `value`.
     * @returns The result produced by `embedQuery`.
     * @throws Errors raised by validation or dependent operations.
     */
    async embedQuery(value) {
      const [embedding] = await embed([value], "query");
      if (!embedding) throw new Error("embedding provider returned no query vector");
      return embedding;
    },
  };
}
