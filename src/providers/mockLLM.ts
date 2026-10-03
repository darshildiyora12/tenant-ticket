import { setTimeout as sleep } from 'node:timers/promises';
import type { ClassifyOptions, LLMProvider } from './types';

// Checked in this order; the first rule with a matching keyword wins.
const CATEGORY_RULES: Array<[category: string, keywords: string[]]> = [
  ['billing', ['charge', 'charged', 'billed', 'refund', 'invoice', 'payment']],
  ['technical', ['crash', 'error', 'slow', 'timeout', 'bug']],
  ['account', ['password', 'email', 'login', 'account']],
  ['feature_request', ['feature', 'option', 'would love']],
];

const PRIORITY_RULES: Array<[priority: string, keywords: string[]]> = [
  ['urgent', ['crash', 'cannot access']],
  ['high', ['refund', 'charged', 'timeout']],
];

function firstMatch(rules: Array<[string, string[]]>, text: string, fallback: string): string {
  const rule = rules.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)));
  return rule ? rule[0] : fallback;
}

export interface MockLLMOptions {
  minDelayMs?: number;
  maxDelayMs?: number;
  slowDelayMs?: number;
}

/**
 * Rule-based stand-in for a real model. It is slow on purpose and, like a real
 * model, returns a JSON *string* that may be broken (see the [[...]] markers).
 */
export class MockLLM implements LLMProvider {
  readonly name = 'mock-llm-v1';
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly slowDelayMs: number;

  constructor(options: MockLLMOptions = {}) {
    this.minDelayMs = options.minDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 3000;
    this.slowDelayMs = options.slowDelayMs ?? 15000;
  }

  async classify(subject: string, body: string, options: ClassifyOptions = {}): Promise<string> {
    const delay = body.includes('[[SLOW]]')
      ? this.slowDelayMs
      : this.minDelayMs + Math.random() * (this.maxDelayMs - this.minDelayMs);
    await sleep(delay);

    if (body.includes('[[ALWAYS_BAD]]')) {
      // Valid JSON, but it does not match the output schema.
      return JSON.stringify({ category: 'unknown', priority: 'asap', summary: '', confidence: 'high' });
    }
    if (body.includes('[[MALFORMED]]') && !options.repairPrompt) {
      // The first call is the one without a repair prompt: reply with cut-off JSON.
      return '{"category": "account", "priority": ';
    }

    const text = `${subject} ${body}`.toLowerCase();
    return JSON.stringify({
      category: firstMatch(CATEGORY_RULES, text, 'other'),
      priority: firstMatch(PRIORITY_RULES, text, 'low'),
      summary: subject.slice(0, 200),
      confidence: body.includes('[[LOW_CONF]]') ? 0.3 : 0.85,
    });
  }
}
