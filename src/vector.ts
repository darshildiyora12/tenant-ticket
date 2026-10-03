/** Cosine similarity: dot(a, b) / (|a| * |b|). A zero vector is similar to nothing. */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  // sqrt(normA * normB) equals |a| * |b| and gives exactly 1 for identical vectors.
  return dot / Math.sqrt(normA * normB);
}

/** Scores are rounded to 4 decimal places in API responses. */
export function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** A vector is stored as a BLOB of 32-bit floats: 256 dimensions = 1 KB per ticket. */
export function toBlob(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

export function fromBlob(blob: Buffer): Float32Array {
  // Copy the bytes so the Float32Array starts at an aligned offset.
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}
