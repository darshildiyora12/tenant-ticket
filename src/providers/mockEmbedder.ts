import type { EmbeddingProvider } from './types';

/** Deterministic bag-of-words embedding: the same text always gives the same vector. */
export class MockEmbedder implements EmbeddingProvider {
  readonly model = 'mock-embed-v1';
  readonly dimensions = 256;

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);

    const words = text
      .toLowerCase()
      .split(/[^\p{L}]+/u)
      .filter((word) => word.length >= 3);

    for (const word of words) {
      let sum = 0;
      for (let i = 0; i < word.length; i++) sum += word.charCodeAt(i);
      vector[sum % this.dimensions] += 1;
    }

    // L2-normalize. Text with no usable words stays a zero vector.
    const length = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));
    return length === 0 ? vector : vector.map((value) => value / length);
  }
}
