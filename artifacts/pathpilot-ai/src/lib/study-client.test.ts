import assert from 'node:assert/strict';
import test from 'node:test';
import { getStudyAnalytics, recordStudySession } from '@workspace/api-client-react';

test('analytics filter, pagination and cancellation travel together; mutations use cookie auth', async () => {
  const original = globalThis.fetch;
  const requests: { url: string; options: RequestInit }[] = [];
  globalThis.fetch = async (input, options) => {
    requests.push({ url: String(input), options: options ?? {} });
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const controller = new AbortController();
    await getStudyAnalytics({ range: 'custom', from: '2026-10-01', to: '2026-10-07' }, 50, controller.signal);
    const first = requests[0]!;
    const url = new URL(first.url, 'http://localhost');
    assert.equal(url.searchParams.get('from'), '2026-10-01');
    assert.equal(url.searchParams.get('to'), '2026-10-07');
    assert.equal(url.searchParams.get('offset'), '50');
    assert.equal(first.options.signal, controller.signal);
    assert.equal(first.options.credentials, 'include');
    const session = { requestId: 'deafbeef-0000-4000-8000-000000000001', goalId: null, startedAt: '2026-10-26T23:30:00.000Z', endedAt: '2026-10-27T00:30:00.000Z' };
    await recordStudySession(session);
    assert.equal(requests[1]!.options.method, 'POST');
    assert.equal(requests[1]!.options.credentials, 'include');
    assert.deepEqual(JSON.parse(String(requests[1]!.options.body)), session);
    assert.equal(new Headers(requests[1]!.options.headers).get('content-type'), 'application/json');
  } finally { globalThis.fetch = original; }
});
