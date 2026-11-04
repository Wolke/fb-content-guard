import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalDecision, classifyLocalImages } from '../extension/local-model.js';
import { createLocalBridge } from '../extension/local-bridge.js';
const image = 'data:image/jpeg;base64,AQID';
test('only a complete exact constrained result can release content', () => {
  assert.equal(parseLocalDecision('"ALLOW"'), 'allow');
  assert.equal(parseLocalDecision('"BLOCK"'), 'block');
  for (const value of ['"UNCERTAIN"', 'ALLOW', '"ALLOW', '```json\n"ALLOW"\n```', '{"decision":"ALLOW"}', 'null', '"ALLOW" extra']) {
    assert.throws(() => parseLocalDecision(value));
  }
});
test('every image must pass, sessions are isolated and destroyed, uncertainty fails closed', async () => {
  let calls = 0, destroyed = 0, outputs = ['"ALLOW"', '"BLOCK"'];
  const session = { clone: async () => ({ addEventListener() {}, destroy() { destroyed++; }, async prompt(input, options) {
    assert.ok(input[0].content[1].value instanceof Blob);
    assert.deepEqual(options.responseConstraint.enum, ['BLOCK', 'ALLOW', 'UNCERTAIN']);
    calls++; return outputs.shift();
  } }) };
  assert.equal((await classifyLocalImages(session, [image, image])).decision, 'block');
  assert.equal(calls, 2); assert.equal(destroyed, 2);
  outputs = ['"ALLOW"', '"UNCERTAIN"'];
  await assert.rejects(classifyLocalImages(session, [image, image]), /LOCAL_UNCERTAIN/);
  assert.equal(destroyed, 4);
  outputs = ['"ALLOW"', '"ALLOW"'];
  assert.equal((await classifyLocalImages(session, [image, image])).decision, 'allow');
  await assert.rejects(classifyLocalImages(session, []), /INVALID_CONTENT/);
  await assert.rejects(classifyLocalImages(session, ['https://example.com/image.jpg']), /INVALID_CONTENT/);
});
test('overflow, cancellation and model failure cannot become an allow', async () => {
  for (const reason of ['overflow', 'cancel', 'failure']) {
    const controller = new AbortController(); let listener, destroyed = false;
    const session = { clone: async () => ({ addEventListener: (_, fn) => listener = fn,
      destroy() { destroyed = true; }, async prompt() {
        if (reason === 'overflow') listener();
        if (reason === 'cancel') controller.abort();
        if (reason === 'failure') throw Error('provider failed');
        return '"ALLOW"';
      } }) };
    await assert.rejects(classifyLocalImages(session, [image], { signal: controller.signal }));
    assert.equal(destroyed, true);
  }
});
function bridgeFixture(timeoutMs = 50) {
  let connect, receive, disconnect; const sent = [];
  const runtime = { id: 'test', getURL: path => 'chrome-extension://test/' + path,
    onConnect: { addListener: fn => connect = fn } };
  const bridge = createLocalBridge({ runtime, timeoutMs });
  const port = { name: 'local-model', sender: { id: 'test', url: runtime.getURL('local-ai.html') },
    onMessage: { addListener: fn => receive = fn }, onDisconnect: { addListener: fn => disconnect = fn },
    postMessage: m => sent.push(m) };
  return { bridge, port, sent, connect: p => connect(p), ready() { connect(port); receive({ type: 'READY' }); },
    receive: m => receive(m), disconnect: () => disconnect() };
}
test('Facebook and foreign extension ports cannot supply model decisions', () => {
  const f = bridgeFixture();
  f.connect({ ...f.port, sender: { id: 'test', url: 'https://www.facebook.com/' } });
  assert.throws(f.bridge.assertReady, /LOCAL_NOT_READY/);
  f.connect({ ...f.port, sender: { id: 'foreign', url: f.port.sender.url } });
  assert.throws(f.bridge.assertReady, /LOCAL_NOT_READY/);
});
test('bridge timeout, closure, invalid response and cancellation fail closed; late replies ignored', async () => {
  for (const scenario of ['timeout', 'close', 'invalid', 'abort', 'valid']) {
    const f = bridgeFixture(); f.ready(); const controller = new AbortController();
    const promise = f.bridge.classify([image], { signal: controller.signal });
    const id = f.sent[0].id;
    assert.throws(() => f.bridge.classify([image]), /BUSY/);
    f.receive({ type: 'RESULT', id: 'wrong-id', ok: true, decision: 'allow' });
    if (scenario === 'close') f.disconnect();
    if (scenario === 'invalid') f.receive({ type: 'RESULT', id, ok: true, decision: 'maybe' });
    if (scenario === 'abort') controller.abort();
    if (scenario === 'valid') {
      f.receive({ type: 'RESULT', id, ok: true, decision: 'block' });
      assert.deepEqual(await promise, { decision: 'block' });
    } else await assert.rejects(promise);
    f.receive({ type: 'RESULT', id, ok: true, decision: 'allow' });
  }
});
