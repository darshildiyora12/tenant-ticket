/** An already-triaged ticket shown to the model as an example. */
export interface ClassifyExample {
  subject: string;
  category: string;
  priority: string;
}

export interface ClassifyOptions {
  /** Similar tickets of the same tenant that were already triaged (simple RAG). */
  examples?: ClassifyExample[];
  /** Sent on the retry only: tells the model what was wrong with its first reply. */
  repairPrompt?: string;
  /** Aborted when the per-call timeout fires, so the provider can cancel its request. */
  signal?: AbortSignal;
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
