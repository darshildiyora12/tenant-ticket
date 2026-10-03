import { describe, expect, it } from 'vitest';
import { createProviders } from '../src/providers';
import { MockEmbedder } from '../src/providers/mockEmbedder';
import { MockLLM } from '../src/providers/mockLLM';
import { cosine } from '../src/vector';
import { SAMPLES } from './samples';

describe('MockLLM', () => {
  const llm = new MockLLM({ minDelayMs: 0, maxDelayMs: 0 });

  it('follows the category and priority rules for every sample ticket', async () => {
    for (const s of SAMPLES) {
      // The repair prompt makes sample #10 ([[MALFORMED]]) answer with valid JSON.
      const reply = JSON.parse(await llm.classify(s.subject, s.body, { repairPrompt: 'fix it' }));
      expect(reply.category, `sample #${s.n}`).toBe(s.expected.category);
      expect(reply.priority, `sample #${s.n}`).toBe(s.expected.priority);
      expect(reply.summary).toBe(s.subject);
      expect(reply.confidence).toBe(0.85);
    }
  });

  it('returns invalid JSON for [[MALFORMED]] on the first call only', async () => {
    const body = 'Something is off with my account settings. [[MALFORMED]]';
    const first = await llm.classify('Settings issue', body);
    const second = await llm.classify('Settings issue', body, { repairPrompt: 'fix it' });

    expect(() => JSON.parse(first)).toThrow();
    expect(JSON.parse(second).category).toBe('account');
  });
});

describe('MockEmbedder', () => {
  const embedder = new MockEmbedder();

  it('returns a normalized 256-dimension vector', async () => {
    const vector = await embedder.embed('Please refund one charge');
    const length = Math.sqrt(vector.reduce((total, value) => total + value * value, 0));

    expect(vector).toHaveLength(256);
    expect(length).toBeCloseTo(1, 10);
  });

  it('is deterministic and ignores case, punctuation and short words', async () => {
    const a = await embedder.embed('Refund my charge, please!');
    const b = await embedder.embed('refund MY charge please');

    expect(cosine(a, b)).toBeCloseTo(1, 10);
  });

  it('scores similar wording higher than unrelated wording', async () => {
    const query = await embedder.embed('refund double charge');
    const related = await embedder.embed('Please refund the extra charge');
    const unrelated = await embedder.embed('Would love a dark mode option');

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});

describe('createProviders', () => {
  it('builds both providers from one setting and rejects unknown names', () => {
    const providers = createProviders('mock');

    expect(providers.llm.name).toBe('mock-llm-v1');
    expect(providers.embedder.model).toBe('mock-embed-v1');
    expect(() => createProviders('nope')).toThrow(/Unknown AI_PROVIDER/);
  });
});
