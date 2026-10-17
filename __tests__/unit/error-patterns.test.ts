/**
 * Unit tests for error pattern matching
 */

import { describe, it, expect } from 'vitest';
import {
  isAssistantMessage,
  has400or413Error,
  hasCreditError,
  hasConnectionError,
  hasRetryableError,
  hasMaxTokensStop,
  hasEmptyStop,
  getErrorCategory,
  CONNECTION_ERROR_PATTERNS,
} from '../../src/error-patterns.js';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

describe('isAssistantMessage', () => {
  it('returns true for assistant messages', () => {
    const msg = { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } as unknown as AgentMessage;
    expect(isAssistantMessage(msg)).toBe(true);
  });

  it('returns false for user messages', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as unknown as AgentMessage;
    expect(isAssistantMessage(msg)).toBe(false);
  });

  it('returns false for toolResult messages', () => {
    const msg = { role: 'toolResult', content: [] } as unknown as AgentMessage;
    expect(isAssistantMessage(msg)).toBe(false);
  });
});

describe('has400or413Error', () => {
  const createAssistantError = (errorMessage: string): AgentMessage =>
    ({ role: 'assistant', stopReason: 'error', errorMessage, content: [] } as unknown as AgentMessage);

  const createUserMessage = (): AgentMessage =>
    ({ role: 'user', content: [{ type: 'text', text: 'test' }] } as unknown as AgentMessage);

  it('detects 400 status code errors', () => {
    const msg = createAssistantError('400 status code (no body)');
    expect(has400or413Error(msg)).toBe(true);
  });

  it('detects 413 status code errors', () => {
    const msg = createAssistantError('413 status code: Payload Too Large');
    expect(has400or413Error(msg)).toBe(true);
  });

  it('detects "bad request" errors', () => {
    const msg = createAssistantError('Bad Request: invalid payload');
    expect(has400or413Error(msg)).toBe(true);
  });

  it('detects "payload too large" errors', () => {
    const msg = createAssistantError('Error: payload too large for context window');
    expect(has400or413Error(msg)).toBe(true);
  });

  it('returns false for non-error messages', () => {
    const msg = { role: 'assistant', stopReason: 'endTurn', content: [] } as unknown as AgentMessage;
    expect(has400or413Error(msg)).toBe(false);
  });

  it('returns false for user messages', () => {
    const msg = createUserMessage();
    expect(has400or413Error(msg)).toBe(false);
  });

  it('returns false for other error types', () => {
    const msg = createAssistantError('500 Internal Server Error');
    expect(has400or413Error(msg)).toBe(false);
  });

  it('returns false for messages without errorMessage', () => {
    const msg = { role: 'assistant', stopReason: 'error', content: [] } as unknown as AgentMessage;
    expect(has400or413Error(msg)).toBe(false);
  });
});

describe('hasCreditError', () => {
  const createAssistantError = (errorMessage: string): AgentMessage =>
    ({ role: 'assistant', stopReason: 'error', errorMessage, content: [] } as unknown as AgentMessage);

  const testCases = [
    { pattern: 'Error: Not Enough Credits', expected: true },
    { pattern: 'insufficient credits for this request', expected: true },
    { pattern: 'Insufficient balance', expected: true },
    { pattern: 'out of credits', expected: true },
    { pattern: 'Payment Required: 402 status code', expected: true },
    { pattern: '402 status code', expected: true },
    // False cases
    { pattern: '400 status code (no body)', expected: false },
    { pattern: 'Connection error', expected: false },
    { pattern: 'Some random error', expected: false },
  ];

  testCases.forEach(({ pattern, expected }) => {
    it(`${expected ? 'detects' : 'rejects'} "${pattern}"`, () => {
      const msg = createAssistantError(pattern);
      expect(hasCreditError(msg)).toBe(expected);
    });
  });

  it('returns false for non-error messages', () => {
    const msg = { role: 'assistant', stopReason: 'endTurn', content: [] } as unknown as AgentMessage;
    expect(hasCreditError(msg)).toBe(false);
  });

  it('returns false for user messages', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'test' }] } as unknown as AgentMessage;
    expect(hasCreditError(msg)).toBe(false);
  });
});

describe('hasConnectionError', () => {
  const createAssistantError = (errorMessage: string): AgentMessage =>
    ({ role: 'assistant', stopReason: 'error', errorMessage, content: [] } as unknown as AgentMessage);

  const testCases = [
    { pattern: 'Connection error', expected: true },
    { pattern: 'Network error occurred', expected: true },
    { pattern: 'Fetch failed: network timeout', expected: true },
    { pattern: 'Socket hang up', expected: true },
    { pattern: 'ECONNRESET: connection reset by peer', expected: true },
    { pattern: 'ECONNREFUSED: connection refused', expected: true },
    { pattern: 'ETIMEDOUT: operation timed out', expected: true },
    { pattern: 'ENOTFOUND: dns lookup failed', expected: true },
    { pattern: 'DNS lookup failed for api.example.com', expected: true },
    { pattern: 'Request ended without sending any chunks', expected: true },
    { pattern: 'Upstream connect error', expected: true },
    { pattern: 'Other side closed connection', expected: true },
    { pattern: 'Reset before headers', expected: true },
    { pattern: 'Broken pipe error', expected: true },
    { pattern: 'Unexpected end of file', expected: true },
    { pattern: 'TLS handshake timeout', expected: true },
    { pattern: 'SSL connection error', expected: true },
    { pattern: 'Timeout awaiting response', expected: true },
    { pattern: 'Request timeout after 30s', expected: true },
    // False cases
    { pattern: '400 status code (no body)', expected: false },
    { pattern: 'Rate limit exceeded', expected: false },
    { pattern: 'Overloaded error', expected: false },
    { pattern: 'Some random error', expected: false },
  ];

  testCases.forEach(({ pattern, expected }) => {
    it(`${expected ? 'detects' : 'rejects'} "${pattern}"`, () => {
      const msg = createAssistantError(pattern);
      expect(hasConnectionError(msg)).toBe(expected);
    });
  });

  it('returns false for non-error messages', () => {
    const msg = { role: 'assistant', stopReason: 'endTurn', content: [] } as unknown as AgentMessage;
    expect(hasConnectionError(msg)).toBe(false);
  });

  it('returns false for user messages', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'test' }] } as unknown as AgentMessage;
    expect(hasConnectionError(msg)).toBe(false);
  });
});


describe('hasRetryableError', () => {
  const createAssistantError = (errorMessage: string): AgentMessage =>
    ({ role: 'assistant', stopReason: 'error', errorMessage, content: [] } as unknown as AgentMessage);

  it('returns true for any generic error by default', () => {
    const msg = createAssistantError('Something went wrong');
    expect(hasRetryableError(msg)).toBe(true);
  });

  it('returns true for stream exhaustion errors', () => {
    const msg = createAssistantError('Max outbound streams is 100, 100 open');
    expect(hasRetryableError(msg)).toBe(true);
  });

  // Force-retry: no error class is excluded anymore.
  it.each([
    'Invalid API key provided',
    'Model not found: gpt-99',
    'Unknown model',
    'Cannot continue from message role: assistant',
    "You've hit your limit · resets 4pm",
    'out of budget',
    'prompt is too long: 250000 tokens > 200000 maximum',
  ])('returns true for %j', errorMessage => {
    expect(hasRetryableError(createAssistantError(errorMessage))).toBe(true);
  });

  it('returns false for non-error messages', () => {
    const msg = { role: 'assistant', stopReason: 'endTurn', content: [] } as unknown as AgentMessage;
    expect(hasRetryableError(msg)).toBe(false);
  });

  it('returns false for user messages', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'test' }] } as unknown as AgentMessage;
    expect(hasRetryableError(msg)).toBe(false);
  });
});



describe('getErrorCategory', () => {
  it('categorizes 400/413 errors', () => {
    expect(getErrorCategory('400 status code')).toBe('400-413');
    expect(getErrorCategory('Bad Request')).toBe('400-413');
    expect(getErrorCategory('Payload too large')).toBe('400-413');
  });

  it('categorizes credit errors', () => {
    expect(getErrorCategory('Error: Not Enough Credits')).toBe('credit');
    expect(getErrorCategory('insufficient balance')).toBe('credit');
    expect(getErrorCategory('402 status code')).toBe('credit');
  });

  it('categorizes connection errors', () => {
    expect(getErrorCategory('Connection error')).toBe('connection');
    expect(getErrorCategory('ECONNRESET')).toBe('connection');
    expect(getErrorCategory('Fetch failed')).toBe('connection');
  });

  it('categorizes stream errors', () => {
    expect(getErrorCategory('Max outbound streams is 100, 100 open')).toBe('connection');
    expect(getErrorCategory('stream limit exhausted')).toBe('connection');
  });

  it('categorizes builtin-handled errors', () => {
    expect(getErrorCategory('Rate limit exceeded')).toBe('builtin');
    expect(getErrorCategory('Server overloaded')).toBe('builtin');
    expect(getErrorCategory('500 Internal Server Error')).toBe('builtin');
  });

  it('categorizes other errors', () => {
    expect(getErrorCategory('Some random error')).toBe('other');
    expect(getErrorCategory('Unknown error')).toBe('other');
  });
});

describe('CONNECTION_ERROR_PATTERNS', () => {
  it('has 21 patterns defined', () => {
    expect(CONNECTION_ERROR_PATTERNS.length).toBe(21);
  });

  it('all patterns are valid regex', () => {
    CONNECTION_ERROR_PATTERNS.forEach((pattern, i) => {
      expect(pattern).toBeInstanceOf(RegExp);
      expect(() => 'test'.match(pattern)).not.toThrow();
    });
  });
});

describe('hasMaxTokensStop', () => {
  it('returns true for assistant messages with stopReason "length"', () => {
    const msg = { role: 'assistant', stopReason: 'length', content: [] } as unknown as AgentMessage;
    expect(hasMaxTokensStop(msg)).toBe(true);
  });

  it('returns false for assistant messages with stopReason "stop"', () => {
    const msg = { role: 'assistant', stopReason: 'stop', content: [] } as unknown as AgentMessage;
    expect(hasMaxTokensStop(msg)).toBe(false);
  });

  it('returns false for assistant messages with stopReason "toolUse"', () => {
    const msg = { role: 'assistant', stopReason: 'toolUse', content: [] } as unknown as AgentMessage;
    expect(hasMaxTokensStop(msg)).toBe(false);
  });

  it('returns false for assistant messages with stopReason "error"', () => {
    const msg = { role: 'assistant', stopReason: 'error', errorMessage: 'something', content: [] } as unknown as AgentMessage;
    expect(hasMaxTokensStop(msg)).toBe(false);
  });

  it('returns false for assistant messages with stopReason "aborted"', () => {
    const msg = { role: 'assistant', stopReason: 'aborted', content: [] } as unknown as AgentMessage;
    expect(hasMaxTokensStop(msg)).toBe(false);
  });

  it('returns false for user messages', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'test' }] } as unknown as AgentMessage;
    expect(hasMaxTokensStop(msg)).toBe(false);
  });

  it('returns false for toolResult messages', () => {
    const msg = { role: 'toolResult', content: [] } as unknown as AgentMessage;
    expect(hasMaxTokensStop(msg)).toBe(false);
  });
});


describe('quota errors are retried and labelled', () => {
  const createAssistantError = (errorMessage: string): AgentMessage =>
    ({ role: 'assistant', stopReason: 'error', errorMessage, content: [] } as unknown as AgentMessage);

  it('hasRetryableError returns true for quota errors', () => {
    expect(hasRetryableError(createAssistantError("You've hit your limit · resets 4pm"))).toBe(true);
    expect(hasRetryableError(createAssistantError('out of budget'))).toBe(true);
  });

  it('getErrorCategory returns quota (checked before builtin rate-limit)', () => {
    expect(getErrorCategory("You've hit your limit · resets 4pm")).toBe('quota');
    expect(getErrorCategory('out of budget')).toBe('quota');
    expect(getErrorCategory('Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day')).toBe('quota');
  });
});

describe('quota patterns do not false-positive on transient/balance errors', () => {
  const createAssistantError = (errorMessage: string): AgentMessage =>
    ({ role: 'assistant', stopReason: 'error', errorMessage, content: [] } as unknown as AgentMessage);

  const expectNotQuota = (messages: string[]) => {
    for (const text of messages) {
      expect(getErrorCategory(text)).not.toBe('quota');
      expect(hasRetryableError(createAssistantError(text))).toBe(true);
    }
  };

  it('Anthropic transient rate-limit messages stay retryable', () => {
    expectNotQuota([
      "This request would exceed your account's rate limit",
      'Server is temporarily limiting requests (not your usage limit) · Rate limited',
    ]);
  });

  it('per-minute rate limits stay retryable', () => {
    expectNotQuota([
      'Rate limit exceeded',
      'Rate Limit Reached', // DeepSeek 429
      'Your account org<ak> request reached organization TPD rate limit,current:10, limit:5', // Kimi TPD
      "You've hit your rate limit — slow down and try again shortly", // burst RPM wording, not plan exhaustion
    ]);
  });

  it('pay-as-you-go balance errors stay retryable (top-up auto-resume)', () => {
    expectNotQuota([
      'Insufficient Balance', // DeepSeek 402
      'Insufficient credits. To increase, visit https://openrouter.ai/settings/credits and add more credits', // OpenRouter 402
      'You exceeded your current token quota: <org-1> 100, please check your account balance', // Kimi balance quota
    ]);
  });

  it('engine overloaded stays retryable (Kimi engine_overloaded_error)', () => {
    expectNotQuota(['The engine is currently overloaded, please try again later']);
  });
});

describe('hasEmptyStop', () => {
  it('returns true for empty content with stopReason stop', () => {
    const msg = { role: 'assistant', stopReason: 'stop', content: [] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(true);
  });

  it('returns true for thinking-only content (no text, no toolCall)', () => {
    const msg = { role: 'assistant', stopReason: 'stop', content: [{ type: 'thinking', thinking: 'let me think...' }] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(true);
  });

  it('returns true for whitespace-only text', () => {
    const msg = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: '   ' }] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(true);
  });

  it('returns false for a real text answer', () => {
    const msg = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Here is the summary.' }] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for a toolCall stop', () => {
    const msg = { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 't1', name: 'pi.bash', arguments: {} }] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for stop with text + toolCall content', () => {
    const msg = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'ok' }, { type: 'toolCall', id: 't1', name: 'pi.bash', arguments: {} }] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for max_tokens stop', () => {
    const msg = { role: 'assistant', stopReason: 'length', content: [] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for error stops', () => {
    const msg = { role: 'assistant', stopReason: 'error', errorMessage: 'boom', content: [] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for aborted stops', () => {
    const msg = { role: 'assistant', stopReason: 'aborted', content: [] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for a real final text-only answer (the legit stop case)', () => {
    const msg = { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'Here is the full deliverable: ...' }] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for non-assistant messages', () => {
    const msg = { role: 'user', content: [{ type: 'text', text: 'hi' }] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });

  it('returns false for toolResult messages', () => {
    const msg = { role: 'toolResult', content: [] } as unknown as AgentMessage;
    expect(hasEmptyStop(msg)).toBe(false);
  });
});

