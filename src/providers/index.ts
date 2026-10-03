import { MockEmbedder } from './mockEmbedder';
import { MockLLM } from './mockLLM';
import type { EmbeddingProvider, LLMProvider } from './types';

export interface Providers {
  llm: LLMProvider;
  embedder: EmbeddingProvider;
}

/**
 * The single place that decides which model is used. AI_PROVIDER picks both
 * providers; to add a real one, implement the two interfaces and add a case.
 */
export function createProviders(aiProvider: string): Providers {
  switch (aiProvider) {
    case 'mock':
      return { llm: new MockLLM(), embedder: new MockEmbedder() };
    default:
      throw new Error(`Unknown AI_PROVIDER "${aiProvider}". Supported: mock`);
  }
}
