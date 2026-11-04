const $ = id => document.getElementById(id);
const stages = { precheck: '前置檢查', images: '圖片下載／轉換', session: '匿名憑證 API', cloud: '清朗分類 API', openai: 'OpenAI Moderation', local: '本機 Gemini Nano', cache: '本機快取', display: '最後顯示', health: '服務健康 API' };
const outcomes = { start:'開始', sent:'已嘗試送出', response:'收到回應', allow:'ALLOW 放行', block:'BLOCK 阻擋', uncertain:'UNCERTAIN 無法確定', error:'失敗', skipped:'略過／未呼叫', waiting:'等待', hidden:'保持隱藏', shown:'已顯示', stale:'舊結果已丟棄' };
const advice = { LOCAL_NOT_READY:'請開啟本機模型設定並啟用，保留模型分頁。', LOCAL_UNCERTAIN:'模型無法確定；依設定繼續隱藏，不代表判定色情。', LOCAL_TIMEOUT:'本機檢查逾時，內容保持隱藏。', WAITING_CAPACITY:'本機排程額度已滿，等候自動重試。', USAGE_LIMIT:'雲端額度已滿，等候額度恢復。', SERVICE_COOLDOWN:'服務暫時限流，等候自動重試。', TOO_MANY_IMAGES:'超過 12 張圖片，未送出分析。', UNSUPPORTED_VECTOR:'向量圖片無法轉換，未送出分析。', CONSENT_REQUIRED:'尚未同意雲端分析，或已撤回同意。' };
let snapshot, busy = false;
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const groups = events => { const m = new Map(); for(const e of events){ const key = `${e.tab}/${e.page}/${e.id}`; if(!m.has(key))m.set(key,[]);m.get(key).push(e); } return [...m.values()].reverse(); };
function draw() {
  if (!snapshot) return;
  const openIds = new Set([...document.querySelectorAll('details[data-id][open]')].map(e=>e.dataset.id));
  $('entries').replaceChildren();
  const all = groups(snapshot.events || []);
  $('enabled').checked = snapshot.enabled; $('model').textContent = snapshot.modelReady ? '已就緒' : '未就緒／未連線';
  $('count').textContent = `${all.length} / ${(snapshot.events || []).length}`;
  const filter = $('filter').value;
  const selected = all.filter(events => filter === 'all' || (filter === 'errors' ? events.some(e=>['error','uncertain'].includes(e.outcome)) : filter === 'blocked' ? events.some(e=>e.outcome === 'block') : events.some(e=>e.stage==='display' && e.outcome === (filter==='shown'?'shown':'hidden'))));
  $('empty').hidden = selected.length > 0;
  for(const events of selected){
    const first = events[0], last = events.at(-1), display = events.filter(e=>e.stage==='display').at(-1);
    const article=node('article'), details=node('details'); details.dataset.id = first.id; details.open=openIds.has(first.id);
    const summary=node('summary');
    summary.append(node('h3',`貼文 #${first.post} · 分頁 ${first.tab} · 頁面 ${first.page.slice(0,8)}`));
    const final = display?.outcome || last.outcome;
    summary.append(node('span',display ? outcomes[final] : `進行中／未取得最後顯示結果`, `badge ${final==='shown'?'good':events.some(e=>e.outcome==='block')?'bad':events.some(e=>['error','uncertain'].includes(e.outcome))?'error':''}`));
    const cloudSent=events.some(e=>e.stage==='cloud'&&e.outcome==='sent'), localSent=events.some(e=>e.stage==='local'&&e.outcome==='sent');
    summary.append(node('p',`${new Date(first.at).toLocaleTimeString()} → ${new Date(last.at).toLocaleTimeString()} · 雲端：${cloudSent?'已嘗試送出':'未記錄送出'} · 本機：${localSent?'已送入':'未記錄送入'} · 嘗試 ${first.id.slice(0,8)}`));
    details.append(summary);const wrap=node('div',undefined,'table-wrap'),table=node('table'),head=node('tr');
    for(const text of ['時間','階段 / API','結果','明細'])head.append(node('th',text));const thead=node('thead');thead.append(head);table.append(thead);const body=node('tbody');
    for(const e of events){
      const tr=node('tr'), info=[];
      if(e.http!==undefined)info.push(`HTTP ${e.http}`);
      if(e.ms!==undefined)info.push(`${e.ms} ms`);
      if(e.image!==undefined)info.push(e.image===0?'純文字':`第 ${e.image} 張`);
      if(e.images!==undefined)info.push(`${e.images} 張圖片`);
      if(e.chars!==undefined)info.push(`${e.chars} 字元`);
      if(e.retryAfterMs!==undefined)info.push(`約 ${Math.ceil(e.retryAfterMs/1000)} 秒後重試`);
      for(const key of ['sexual','sexualMinors','sexualScore','sexualMinorsScore'])if(e[key]!==undefined)info.push(`${key}=${e[key]}`);
      if(e.error)info.push(`${e.error}${advice[e.error]?'：'+advice[e.error]:''}`);
      if(e.detailAvailable===false)info.push('後台未提供呼叫明細；是否送達 OpenAI、模型旗標與分數均未知。');
      tr.append(node('td',new Date(e.at).toLocaleTimeString()),node('td',stages[e.stage]||e.stage),node('td',e.detailAvailable===false?'未提供':outcomes[e.outcome]||e.outcome),node('td',info.join(' · ')||'—'));body.append(tr);
    }
    table.append(body);wrap.append(table);details.append(wrap);article.append(details);$('entries').append(article);
  }
}
async function load(){if(busy)return;busy=true;try{const r=await chrome.runtime.sendMessage({type:'DIAGNOSTICS_STATUS'});if(!r?.ok)throw Error();snapshot=r;draw();}catch{$('status').textContent='無法讀取背景程式，請重新載入擴充功能後重開此頁。';}finally{busy=false;}}
$('refresh').onclick=load;$('filter').onchange=draw;
$('enabled').onchange=async()=>{try{const r=await chrome.runtime.sendMessage({type:'DIAGNOSTICS_ENABLE',enabled:$('enabled').checked});if(!r?.ok)throw Error();$('status').textContent=r.enabled?'已啟用。接下來的新檢查會記錄；不會補回過去結果。':'已關閉並清除本機診斷紀錄。';await load();}catch{$('status').textContent='設定失敗，請重新載入擴充功能。';}};
$('clear').onclick=async()=>{try{const r=await chrome.runtime.sendMessage({type:'DIAGNOSTICS_CLEAR'});if(!r?.ok)throw Error();$('status').textContent='紀錄已清除；清除前的進行中嘗試不會補寫回來。';await load();}catch{$('status').textContent='清除失敗，請再試一次。';}};
$('export').onclick=()=>{if(!snapshot)return;const data={schema:1,extensionVersion:chrome.runtime.getManifest().version,exportedAt:new Date().toISOString(),events:snapshot.events};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='qinglang-diagnostics.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('status').textContent='已匯出目前顯示時點的紀錄，不含貼文內容或金鑰。';};
setInterval(()=>{if($('auto').checked&&!document.hidden)void load();},3000);void load();
