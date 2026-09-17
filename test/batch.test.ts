import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { brindle, headers, serving, CODE_TEMPLATE, SUPPRESSED, type Serving, type UnderTest } from './harness.js';

let brindleUnderTest: UnderTest;
let api: Serving;

beforeEach(async () => {
  brindleUnderTest = brindle();
  api = await serving(brindleUnderTest.app);
});

afterEach(async () => {
  brindleUnderTest.carrier.stop();
  await api.stop();
});

function batch(messages: unknown[]) {
  return fetch(`${api.url}/v1/messages/batch`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ messages }),
  });
}

interface BatchAnswer {
  batch_id: string;
  accepted: { index: number; id: string }[];
  rejected: { index: number; code: string; detail: string }[];
}

describe('sending a batch', () => {
  it('sends the rows it can and hands the rest back by position and code', async () => {
    const response = await batch([
      { to: 'colm.wardle@brookmail.com', channel: 'email', subject: 'Ready', body: '<p>Ready.</p>' },
      { to: SUPPRESSED, channel: 'email', subject: 'Ready', body: '<p>Ready.</p>' },
      { to: '+447700900771', channel: 'sms', template_id: CODE_TEMPLATE, variables: { code: '4471' } },
      { to: 'not an address', channel: 'email', subject: 'Ready', body: '<p>Ready.</p>' },
      { channel: 'email', subject: 'Ready', body: '<p>Ready.</p>' },
    ]);
    const answer = (await response.json()) as BatchAnswer;

    expect(response.status).toBe(202);
    expect(answer.accepted.map((row) => row.index)).toEqual([0, 2]);
    expect(answer.rejected.map((row) => [row.index, row.code])).toEqual([
      [1, 'recipient_suppressed'],
      [3, 'invalid_request'],
      [4, 'invalid_request'],
    ]);
  });

  it('puts every row of one batch under the same batch id', async () => {
    const response = await batch([
      { to: 'gwen.bevan@brookmail.com', channel: 'email', subject: 'One', body: '<p>One.</p>' },
      { to: 'ivor.nowak@brookmail.com', channel: 'email', subject: 'Two', body: '<p>Two.</p>' },
    ]);
    const answer = (await response.json()) as BatchAnswer;

    const ids = answer.accepted.map((row) => brindleUnderTest.store.message(row.id)?.batch_id);
    expect(ids).toEqual([answer.batch_id, answer.batch_id]);
    expect(answer.batch_id.startsWith('batch_')).toBe(true);
  });

  it('will not take more than five hundred at once', async () => {
    const many = Array.from({ length: 501 }, (_row, index) => ({
      to: `rider${index}@brookmail.com`,
      channel: 'email',
      subject: 'Ready',
      body: '<p>Ready.</p>',
    }));
    const response = await batch(many);
    const problem = (await response.json()) as { code: string; detail: string };

    expect(response.status).toBe(422);
    expect(problem.code).toBe('batch_too_large');
    expect(problem.detail).toContain('501');
  });
});
