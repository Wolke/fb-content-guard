import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticLog, safeEvent, safeProviderEvents } from '../extension/diagnostic-log.js';
import { moderate } from '../server/moderation.mjs';
const context = epoch => ({ epoch, id: crypto.randomUUID(), page: crypto.randomUUID(), post: 1, tab: 2 });
test('diagnostic sanitization rejects raw data, invalid scores and arbitrary errors', () => {
  const result = safeEvent({ stage:'openai', outcome:'allow', sexualScore:0.2, sexualMinorsScore:Infinity, text:'secret', token:'secret', url:'https://private', raw:'secret', error:'secret', http:200 });
  assert.deepEqual(result, { stage:'openai', outcome:'allow', http:200, error:'UNKNOWN_ERROR', sexualScore:0.2 });
  assert.equal(safeEvent({stage:'private',outcome:'allow'}), null);
  assert.equal(safeProviderEvents(Array(50).fill({outcome:'allow'})).length,12);
});
test('journal is opt-in, bounded, expires and clear invalidates late writes across restart', async () => {
  let saved, clock=100000000;
  const fixture=()=>createDiagnosticLog({read:async()=>saved,write:async s=>{saved=structuredClone(s);},now:()=>clock});
  let log=fixture(); let cfg=await log.config();
  await log.add(context(cfg.epoch),{stage:'cloud',outcome:'sent'});
  assert.equal((await log.snapshot()).events.length,0);
  cfg=await log.setEnabled(true);const c=context(cfg.epoch);
  for(let i=0;i<605;i++)await log.add(c,{stage:'cloud',outcome:'sent',text:'secret'});
  assert.equal((await log.snapshot()).events.length,600);
  assert.equal(JSON.stringify(saved).includes('secret'),false);
  log=fixture();assert.equal((await log.snapshot()).events.length,600);
  await log.clear();await log.add(c,{stage:'display',outcome:'shown'});
  assert.equal((await log.snapshot()).events.length,0);
  cfg=await log.config();await log.add(context(cfg.epoch),{stage:'local',outcome:'uncertain'});
  clock+=21600001;assert.equal((await log.snapshot()).events.length,0);
  await log.setEnabled(false);assert.equal(saved.events.length,0);
});
test('provider diagnostics report only safe per-image categories without changing decisions', async () => {
  const payload={text:'private text',images:['data:image/jpeg;base64,AQID'],diagnostics:true};
  const fetcher=async()=>Response.json({id:'private-id',model:'private-field',results:[{categories:{sexual:false,'sexual/minors':false},category_scores:{sexual:0.12,'sexual/minors':0.01,other:0.5},private:'secret'}]});
  const r=await moderate(payload,'secret-key',fetcher);
  assert.equal(r.decision,'allow');assert.equal(r.diagnostics.providerAttempted,true);
  assert.equal(r.diagnostics.events[0].sexualScore,0.12);
  assert.equal(r.diagnostics.events[0].http,200);
  assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(JSON.stringify(r).includes('secret'),false);
  const noDebug=await moderate({...payload,diagnostics:false},'secret-key',fetcher);
  assert.deepEqual(noDebug,{decision:'allow'});
  await assert.rejects(moderate(payload,'secret-key',async()=>new Response('secret',{status:429})),e=>{
    assert.equal(e.diagnostics.events[0].error,'PROVIDER_RATE_LIMIT');assert.equal(e.diagnostics.events[0].http,429);
    return !JSON.stringify(e).includes('secret');
  });
});
