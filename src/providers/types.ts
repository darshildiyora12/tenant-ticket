export interface ClassifyOptions {
  /** Sent on the retry only: tells the model what was wrong with its first reply. */
  repairPrompt?: string;
}

export interface LLMProvider {
  readonly name: string;
  /** Returns the raw model reply. The caller parses and validates it. */
  classify(subject: string, body: string, options?: ClassifyOptions): Promise<string>;
}

export interface EmbeddingProvider {
  /** Stored with every vector, so vectors from different models are never mixed up. */
  readonly model: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}
