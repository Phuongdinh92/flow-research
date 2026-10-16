/* Public descriptive market UI. No private signal model, wallet labels, or trading. */
(function(root){
'use strict';
const DAY=86400000,TTL=900000;
const NAMES={binance:'Binance',bitget:'Bitget',gate:'Gate',whitebit:'WhiteBIT'};
function numeric(v){if(typeof v!=='number'||!Number.isFinite(v))throw Error('Thiếu hoặc sai trường số');return v;}
function summarize(bars,asOf){
 numeric(asOf);if(!Array.isArray(bars)||bars.length<31)throw Error('Chưa đủ 31 nến ngày đã đóng.');
 const tail=bars.slice(-31);
 for(let i=0;i<tail.length;i++){
  const b=tail[i];numeric(b.time);numeric(b.end);numeric(b.close);numeric(b.quote);
  if(b.time%DAY||b.end!==b.time+DAY-1||b.end>=asOf||b.close<=0||b.quote<0)throw Error('Nến không hợp lệ hoặc chưa đóng.');
  if(i&&b.time-tail[i-1].time!==DAY)throw Error('Thiếu ngày trong 31 ngày gần nhất.');
 }
 const last=tail.at(-1);if(last.end!==Math.floor(asOf/DAY)*DAY-1)throw Error('Thiếu nến ngày UTC đã đóng mới nhất; chưa tính chỉ số hiện tại.');
 const recent=tail.slice(-7),q=recent.reduce((s,b)=>s+b.quote,0);
 const hasBuy=recent.every(b=>typeof b.buy==='number'&&Number.isFinite(b.buy)&&b.buy>=0&&b.buy<=b.quote*(1+1e-9));
 return {return7:last.close/tail[23].close-1,return30:last.close/tail[0].close-1,turnover:tail.slice(-20).reduce((s,b)=>s+b.quote,0)/20,buyShare:hasBuy&&q>0?recent.reduce((s,b)=>s+b.buy,0)/q:null,end:last.end};
}
function validateSnapshot(data,now=Date.now()){
 if(!data||data.schemaVersion!==1||!Array.isArray(data.sources))throw Error('Bản lưu sai định dạng.');
 if(!Number.isFinite(data.generatedAt)||data.generatedAt>now+900000)throw Error('Thời điểm bản lưu không hợp lệ.');
 const sources=[],seenSources=new Set();
 for(const s of data.sources){
  if(!s||!NAMES[s.sourceId]||seenSources.has(s.sourceId)||!Array.isArray(s.rows))throw Error('Nguồn trong bản lưu không hợp lệ.');
  seenSources.add(s.sourceId);const keys=new Set(),rows=[];
  for(const r of s.rows){
   if(!r||r.sourceId!==s.sourceId||typeof r.instrument!=='string'||!/^[\p{L}\p{N}_.-]{1,80}$/u.test(r.instrument)||typeof r.base!=='string'||!/^[\p{L}\p{N}_.-]{1,80}$/u.test(r.base)||r.quote!=='USDT'||r.key!==s.sourceId+':'+r.instrument||keys.has(r.key))throw Error('Định danh cặp trong bản lưu không hợp lệ.');
   for(const k of ['last','return24','turnover24','asOf'])numeric(r[k]);
   if(r.last<=0||r.turnover24<0||r.return24< -1||r.asOf<946684800000||r.asOf>now+900000)throw Error('Giá hoặc thời gian trong bản lưu không hợp lệ.');
   keys.add(r.key);rows.push({...r});
  }
  if(!Number.isInteger(s.instrumentCount)||s.instrumentCount<rows.length||(rows.length&&!Number.isFinite(s.fetchedAt))||(s.fetchedAt!==null&&(!Number.isFinite(s.fetchedAt)||s.fetchedAt>now+900000)))throw Error('Số cặp hoặc thời điểm lấy dữ liệu không hợp lệ.');
  sources.push({...s,name:NAMES[s.sourceId],rows,mode:'saved',asOf:rows.length?Math.min(...rows.map(r=>r.asOf)):null,errors:Array.isArray(s.errors)?s.errors:[]});
 }
 return sources;
}
function rowsFor(sources,{query='',source='all',sort='turnover24',now=Date.now()}={}){
 const q=query.trim().toUpperCase();const rows=sources.flatMap(s=>s.rows.map(r=>({...r,sourceName:s.name||NAMES[r.sourceId],mode:s.mode,stale:now-r.asOf>TTL,lastAttemptError:s.lastAttemptError||null}))).filter(r=>(source==='all'||r.sourceId===source)&&(!q||r.base.toUpperCase().includes(q)||r.instrument.includes(q)));
 return rows.sort((a,b)=>sort==='base'?a.base.localeCompare(b.base)||a.sourceId.localeCompare(b.sourceId):(b[sort]-a[sort])||a.key.localeCompare(b.key));
}
const api={summarize,validateSnapshot,rowsFor,TTL,NAMES};root.FlowUI=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

if(typeof document!=='undefined'){
'use strict';
const U=FlowUI,$=s=>document.querySelector(s),SIZE=50,SOURCES=FlowMarket.SOURCES||[{id:'binance',name:'Binance',supportsDaily:true},{id:'bitget',name:'Bitget',supportsDaily:true}];
const state={sources:[],busy:false,page:0,cooldown:0,detailSeq:0,histories:{},revision:0,overviewMode:'bubbles',flowSnapshot:null,historyBusy:false,historyCancelled:false,historyCooldown:0,detailKey:null,detailMode:'price',detailWindow:120,detailInterval:'1d',detailMA:true,detailWarning:''};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('vi-VN',{maximumFractionDigits:d}):'—';
const pct=v=>Number.isFinite(v)?(v>0?'+':'')+fmt(v*100)+'%':'—';
const date=t=>Number.isFinite(t)?new Date(t).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}):'—';
const day=t=>new Date(t).toISOString().slice(0,10);
const age=t=>{const n=Math.max(0,Math.floor((Date.now()-t)/60000));return n<1?'vừa xong':n<60?n+' phút trước':n<1440?Math.floor(n/60)+' giờ trước':Math.floor(n/1440)+' ngày trước';};
const colored=v=>'<span class="'+(v<0?'negative':'positive')+'">'+pct(v)+'</span>';
function status(message,kind=''){const n=$('#status');n.textContent=message;n.className='status '+kind;}
function log(message){const n=$('#log');if(n.textContent==='Chưa gửi yêu cầu mạng.')n.textContent='';n.textContent+=new Date().toLocaleTimeString('vi-VN')+' · '+message+'\n';}
function allRows(){return state.sources.flatMap(s=>s.rows);}
function filteredRows(){return U.rowsFor(state.sources,{query:$('#search').value,source:$('#source').value,sort:$('#sort').value});}
function renderCharts(){
 const rows=filteredRows(),C=FlowCharts,V=FlowChartsView,now=Date.now();
 let broad=C.scatter24(rows,{now}),historical=false;
 if(!broad.points.length&&rows.length){const reference=Math.max(...rows.map(r=>r.asOf));broad=C.scatter24(rows,{now:reference});historical=true;}
 const points=[...broad.points].sort((a,b)=>b.turnover24-a.turnover24),bubbles=state.overviewMode==='bubbles',chartWidth=Math.max(320,$('#overview-chart').clientWidth||1200),bubbleLimit=chartWidth<600?24:Number($('#bubble-count').value)||40;
 $('#overview-chart').className=points.length?'chart-box market-chart':'chart-box empty';
 $('#overview-chart').innerHTML=points.length?(bubbles?V.bubble(points.slice(0,bubbleLimit),{width:chartWidth,sizeBy:$('#bubble-size').value||'equal'}):V.scatter(points,{kind:'24h',width:chartWidth})):'<strong>Chưa có dữ liệu để vẽ</strong><p>Quét dữ liệu mới hoặc điều chỉnh bộ lọc.</p>';
 $('#view-bubbles').className=bubbles?'selected':'';$('#view-scatter').className=bubbles?'':'selected';$('#view-bubbles').setAttribute?.('aria-pressed',String(bubbles));$('#view-scatter').setAttribute?.('aria-pressed',String(!bubbles));
 const c=broad.coverage,range=c.asOfMin?date(c.asOfMin)+' → '+date(c.asOfMax):'chưa có';
 $('#overview-meta').textContent=(historical?'BẢN LƯU ĐÃ CŨ · ':'')+(bubbles?'Hiển thị '+Math.min(bubbleLimit,points.length)+' cặp có giá trị giao dịch lớn nhất; '+($('#bubble-size').value==='turnover'?'diện tích tỷ lệ giá trị giao dịch 24H (USDT). ':'bóng bằng nhau để đọc rõ tên và giá; kích thước không biểu diễn volume/vốn hóa. ')+ '':'Tất cả '+points.length+' điểm hợp lệ; trục ngang giá 24H (%), trục dọc giá trị giao dịch 24H (USDT, log10). ')+c.used+'/'+c.input+' cặp sau bộ lọc dùng được · '+c.excluded+' bị loại · Thời điểm nguồn: '+range+'. Mỗi sàn giữ riêng; đây không phải vốn hóa hoặc tiền mua ròng.';
 $('#chart-exclusions').textContent=broad.excluded.length?broad.excluded.map(e=>(e.key||'Không rõ mã')+': '+e.reason).join('\n'):'Không có cặp bị loại trong tập ticker đang lọc. Các cặp thiếu từ lúc đọc nguồn được ghi tại bảng độ phủ.';
 let fromSummary=state.flowSnapshot?C.scatter7Summary(state.flowSnapshot,rows,{now}):null,fromHistory=C.scatter7(state.histories,rows,{now});
 let merged=new Map((fromSummary?.points||[]).map(p=>[p.key,p]));for(const p of fromHistory.points){if(!merged.has(p.key)||p.fetchedAt>=merged.get(p.key).fetchedAt)merged.set(p.key,p);}
 const flow=[...merged.values()],inScope=rows.filter(r=>r.sourceId==='binance').length,eligible=!$('#search').value.trim()&&['all','binance'].includes($('#source').value)?(state.sources.find(s=>s.sourceId==='binance')?.instrumentCount||inScope):inScope;
 $('#flow-chart').className=flow.length?'chart-box flow-chart':'chart-box empty';$('#flow-chart').innerHTML=flow.length?V.scatter(flow,{kind:'7d',width:chartWidth}):'<strong>Chưa có chuỗi Binance phù hợp để vẽ</strong><p>'+(!['all','binance'].includes($('#source').value)?'Nguồn '+U.NAMES[$('#source').value]+' này không có trường taker mua để vẽ bản đồ Binance.':'Đang đọc bản lưu lịch sử; có thể bấm cập nhật lịch sử theo bộ lọc.')+'</p>';
 $('#load-history').disabled=state.historyBusy||!['all','binance'].includes($('#source').value);
 const ends=flow.map(p=>p.end),last=ends.length?Math.max(...ends):null;
 const collectionNotes=fromSummary?.sourceErrors||[],historyErrors=collectionNotes.filter(e=>e.stage==='klines'),registryNotes=collectionNotes.filter(e=>e.stage!=='klines');
 $('#flow-meta').textContent=flow.length+'/'+eligible+' cặp Binance có điểm hợp lệ trong phạm vi đang lọc'+(last?' · Nến cuối '+day(last)+' UTC':'')+'. Tỷ lệ mua có trọng số theo quote volume; không phải tỷ lệ cá mập hoặc xác suất tăng. '+(fromSummary?'Bộ đọc bản lưu 31 ngày đã thử '+fromSummary.coverage.attemptedCount+'/'+fromSummary.coverage.eligibleInstrumentCount+' cặp; '+historyErrors.length+' cặp lỗi/thiếu lịch sử và '+registryNotes.length+' ghi nhận danh mục.':'Lịch sử đang hiển thị theo những cặp đã đọc được.');
 const missing=(fromSummary?.excluded||fromHistory.excluded).filter(e=>e.key?.startsWith('binance:')&&!merged.has(e.key));
 $('#flow-exclusions').textContent=(missing.length?'Trong bộ lọc hiện tại: '+missing.map(e=>e.key+': '+e.reason).join('; ')+'. ':'Không có cặp Binance bị thiếu trong bộ lọc hiện tại. ')+(collectionNotes.length?'Nhật ký của toàn bộ bản lưu 31 ngày: '+collectionNotes.map(e=>(e.instrument||e.code||e.stage)+': '+e.message).join('; '):'Chưa có ghi nhận từ bộ thu thập diện rộng.');
}
function render(){
 const rows=allRows(),valid=state.sources.filter(s=>s.rows.length),fresh=valid.filter(s=>s.rows.every(r=>Date.now()-r.asOf<=U.TTL));
 $('#count').textContent=fmt(rows.length,0);$('#source-count').textContent=valid.length+' / '+SOURCES.length;$('#coverage-sub').textContent=fresh.length+' nguồn có bản ghi/phản hồi trong 15 phút';
 const latest=rows.length?Math.max(...rows.map(r=>r.asOf)):null;$('#asof').textContent=latest?age(latest):'Chưa có';$('#fetched').textContent=latest?date(latest)+' · giờ Việt Nam':'Thời điểm do nguồn ghi nhận';$('#export').disabled=!rows.length;
 $('#coverage').innerHTML=SOURCES.map(({id})=>{
  const s=state.sources.find(x=>x.sourceId===id);
  if(!s)return '<article class="source-card"><div class="card-head"><strong>'+U.NAMES[id]+'</strong><span class="pill">'+(state.busy?'Đang đọc…':'Chưa có dữ liệu')+'</span></div><p class="small">Cần phản hồi hợp lệ từ danh mục và ticker.</p></article>';
  const stale=s.rows.filter(r=>Date.now()-r.asOf>U.TTL).length,label=s.rows.length?(s.mode==='saved'?'Bản lưu':'Đã đọc trực tiếp'):'Đọc thất bại';
  return '<article class="source-card"><div class="card-head"><strong>'+esc(s.name)+'</strong><span class="pill '+(s.rows.length&&!stale&&!s.lastAttemptError?'positive':'warning')+'">'+label+(stale?' · có dữ liệu cũ':'')+'</span></div><div class="source-number">'+fmt(s.rows.length,0)+' <span>/ '+fmt(s.instrumentCount,0)+' cặp hợp lệ</span></div><p class="small">USDT · '+(s.asOf?date(s.asOf)+' · '+age(s.asOf):'Chưa có thời điểm nguồn')+'</p>'+(stale?'<p class="small warning">'+stale+' cặp có ticker quá 15 phút.</p>':'')+(s.timestampKind==='source_response'||s.timestampKind==='response_received'?'<p class="small">Thời gian phản hồi; nguồn không có timestamp riêng từng mã. Chưa xác nhận thời điểm giao dịch cuối.</p>':'')+(s.capabilities?.browserDirect===false?'<p class="small warning">Nguồn dùng bản thu thập máy chủ; API không cho trang gọi trực tiếp (CORS).</p>':'')+(s.lastAttemptError?'<p class="small negative">Lần đọc mới lỗi: '+esc(s.lastAttemptError)+'</p>':'')+(s.errors?.length?'<details><summary>'+s.errors.length+' ghi nhận chất lượng</summary><p class="small">'+s.errors.slice(0,12).map(x=>esc(typeof x==='string'?x:JSON.stringify(x))).join('<br>')+'</p></details>':'')+'</article>';
 }).join('');
 renderCharts();
 const filtered=filteredRows(),pages=Math.max(1,Math.ceil(filtered.length/SIZE));state.page=Math.min(state.page,pages-1);const shown=filtered.slice(state.page*SIZE,(state.page+1)*SIZE);
 $('#prev').disabled=state.page===0;$('#next').disabled=state.page>=pages-1;$('#page-info').textContent=filtered.length?fmt(filtered.length,0)+' cặp khớp bộ lọc · Trang '+(state.page+1)+' / '+pages:'Không có cặp khớp bộ lọc';
 if(!shown.length){$('#table').className='empty';$('#table').innerHTML='<strong>'+(!rows.length?'Chưa có dữ liệu hợp lệ':'Không tìm thấy cặp')+'</strong><p>'+(!rows.length?'Bấm quét mới để kiểm tra nguồn công khai.':'Thử tên mã hoặc chọn lại nguồn.')+'</p>';return;}
 $('#table').className='table-scroll';$('#table').innerHTML='<table><thead><tr><th>Cặp / Sàn</th><th>Giá · USDT</th><th>Giá 24H</th><th>GD 24H · triệu USDT</th><th>Thời điểm nguồn</th></tr></thead><tbody>'+shown.map(r=>'<tr><td><button class="asset" data-key="'+esc(r.key)+'">'+esc(r.base)+' / USDT ↗</button><div class="row-note">'+U.NAMES[r.sourceId]+' · '+esc(r.instrument)+'</div></td><td>'+fmt(r.last,8)+'</td><td>'+colored(r.return24)+'</td><td>'+fmt(r.turnover24/1e6,3)+'</td><td><span class="'+(r.stale?'warning':'muted')+'">'+(r.stale?'Cũ · ':'')+age(r.asOf)+'</span><div class="row-note">'+(r.mode==='saved'?'Bản lưu':'API trực tiếp')+'</div></td></tr>').join('')+'</tbody></table>';
}
async function initial(){
 const revision=state.revision;
 render();try{const r=await fetch('data/market-snapshot.json',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(state.revision!==revision)return;state.sources=U.validateSnapshot(data);render();status('Đã mở bản lưu có nguồn gốc: '+fmt(allRows().length,0)+' cặp/sàn. Bấm “Quét dữ liệu mới” để cập nhật; thời điểm của từng nguồn hiển thị bên dưới.');log('Mở bản lưu lấy lúc '+date(data.generatedAt)+'. Không coi bản lưu là lần gọi API mới.');}
 catch(e){if(state.revision!==revision)return;status('Chưa đọc được bản lưu. Bấm “Quét dữ liệu mới” để lấy dữ liệu từ nguồn.');log('Bản lưu: '+e.message);}
}
async function loadAuxiliary(){
 const jobs=await Promise.allSettled(['data/flow-snapshot.json','data/history-snapshot.json'].map(async path=>{const r=await fetch(path,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(path+': HTTP '+r.status);return r.json();}));
 if(jobs[0].status==='fulfilled'){
  try{const snapshot=jobs[0].value;FlowCharts.scatter7Summary(snapshot,allRows());state.flowSnapshot=snapshot;log('Bản lưu lực mua Binance: '+snapshot.records.length+' cặp, lấy lúc '+date(snapshot.generatedAt)+'.');}catch(e){log('Bản lưu lực mua không hợp lệ: '+e.message);}
 }else log('Chưa đọc được bản lưu lực mua: '+jobs[0].reason.message);
 if(jobs[1].status==='fulfilled'){
  const data=jobs[1].value;
  if(data?.schemaVersion===1&&data.histories&&typeof data.histories==='object')for(const [key,h] of Object.entries(data.histories)){
   try{if(!/^(binance|bitget|gate|whitebit):[\p{L}\p{N}_.-]{1,80}$/u.test(key)||!Number.isFinite(h.fetchedAt))throw Error('Định danh hoặc thời điểm sai');FlowCharts.summaryDaily(h.bars,h.asOf);if(!state.histories[key]||h.fetchedAt>state.histories[key].fetchedAt)state.histories[key]=h;}catch(e){log(key+': lịch sử lưu không hợp lệ: '+e.message);}
  }
 }
 render();
}
async function loadHistory(){
 if(state.historyBusy)return;if(Date.now()<state.historyCooldown){$('#history-status').textContent='Nguồn yêu cầu chờ '+Math.ceil((state.historyCooldown-Date.now())/1000)+' giây.';return;}
 const sorted=filteredRows().filter(r=>r.sourceId==='binance').sort((a,b)=>b.turnover24-a.turnover24),chosen=$('#history-count').value,selected=chosen==='all'?sorted:sorted.slice(0,Number(chosen));
 if(!selected.length){$('#history-status').textContent='Không có cặp Binance khớp bộ lọc. Chọn Binance hoặc cả hai sàn để đọc lực mua.';return;}
 state.historyBusy=true;state.historyCancelled=false;$('#load-history').disabled=true;$('#history-count').disabled=true;$('#cancel-history').hidden=false;let index=0,done=0,ok=0,failed=0;
 const progress=()=>{$('#history-status').textContent='Đọc '+done+'/'+selected.length+' cặp Binance · '+ok+' thành công · '+failed+' lỗi/thiếu lịch sử'+(state.historyCancelled?' · Đang dừng sau yêu cầu hiện tại':'');};progress();
 async function worker(){while(index<selected.length&&!state.historyCancelled){const r=selected[index++];try{const h=await FlowMarket.history(r.sourceId,r.instrument);const summary=FlowCharts.summaryDaily(h.bars,h.asOf);if(!summary.current||summary.return7===null||summary.buyShare7===null)throw Error('Chưa đủ chuỗi mới và taker mua để vẽ 7D');state.histories[r.key]=h;ok++;}catch(e){failed++;log(r.key+' lịch sử: '+e.message);if(e.retryAfterMs||/HTTP (418|429|403|451)/.test(e.message)){state.historyCancelled=true;state.historyCooldown=Date.now()+Math.max(60000,e.retryAfterMs||0);}}done++;progress();if(done%5===0)renderCharts();await new Promise(resolve=>setTimeout(resolve,175));}}
 await Promise.all([worker(),worker()]);state.historyBusy=false;$('#load-history').disabled=false;$('#history-count').disabled=false;$('#cancel-history').hidden=true;renderCharts();$('#history-status').textContent=(state.historyCancelled?'Đã dừng. ':'Hoàn tất. ')+ok+'/'+selected.length+' cặp đọc được; '+failed+' lỗi/thiếu lịch sử. Không thay dữ liệu thiếu bằng số 0.';
}
async function scan(){
 if(state.busy)return;if(Date.now()<state.cooldown){status('Thử quét lại sau '+Math.ceil((state.cooldown-Date.now())/1000)+' giây.','error');return;}
 state.revision++;state.busy=true;$('#load').disabled=true;status('Đang khám phá danh mục và đọc ticker của '+SOURCES.length+' sàn; nguồn không cho gọi trực tiếp giữ bản lưu có thời điểm…');render();let successes=0;
 const direct=SOURCES.filter(s=>s.capabilities?.browserDirect!==false);
 const attempts=await Promise.allSettled(direct.map(async ({id})=>{
  const s=await FlowMarket.scanSource(id);if(!s.rows.length)throw Error('Không có cặp hợp lệ.');
  return {...s,asOf:Math.min(...s.rows.map(r=>r.asOf)),mode:'live',lastAttemptError:null,status:s.errors?.length?'partial':'ok'};
 }));
 attempts.forEach((r,i)=>{
  const id=direct[i].id,old=state.sources.find(s=>s.sourceId===id);
  if(r.status==='fulfilled'){successes++;state.sources=state.sources.filter(s=>s.sourceId!==id).concat(r.value);log(U.NAMES[id]+': '+r.value.rows.length+'/'+r.value.instrumentCount+' cặp hợp lệ, '+(r.value.errors?.length||0)+' ghi nhận chất lượng.');}
  else {const error=r.reason?.message||String(r.reason);if(old)old.lastAttemptError=error;else state.sources.push({sourceId:id,name:U.NAMES[id],asOf:null,fetchedAt:Date.now(),instrumentCount:0,rows:[],errors:[error],lastAttemptError:error,mode:'live',status:'error'});log(U.NAMES[id]+': '+error+'. Không tạo dữ liệu thay thế.');}
 });
 state.busy=false;state.cooldown=Date.now()+Math.max(30000,...attempts.map(r=>r.status==='rejected'?(r.reason.retryAfterMs||0):0));$('#load').disabled=false;render();status('Đã đọc mới '+successes+'/'+direct.length+' nguồn cho phép trình duyệt đọc trực tiếp · '+fmt(allRows().length,0)+' cặp/sàn có dữ liệu. '+(successes<direct.length?'Nguồn bị lỗi giữ nguyên nhãn dữ liệu cũ/bản lưu, nếu có. ':'')+(SOURCES.length>direct.length?(SOURCES.length-direct.length)+' nguồn chỉ dùng bản thu thập máy chủ có thời điểm. ':'')+'Chưa có bằng chứng ví để xác nhận cá mập.',successes===direct.length?'ok':'error');
}
function stat(label,value){return '<p><span>'+esc(label)+'</span><strong>'+value+'</strong></p>';}
function renderDetail(row,h,warning=''){
 let d,statsError='';const interval=state.detailInterval;
 try{d=FlowCharts.summaryDaily(h.bars,h.asOf,{window:state.detailWindow});}catch(e){statsError=e.message;const last=h.bars.at(-1);d={return7:null,return30:null,turnover20:null,buyShare7:null,current:last?.end===Math.floor(Date.now()/86400000)*86400000-1,latestEnd:last?.end,coverage:{days:h.bars.slice(-state.detailWindow).length}};}
 const aggregate=FlowCharts.aggregateBarsUTC(h.bars,{interval,asOf:h.asOf,windowDays:state.detailWindow});
 const averages=state.detailMA?new Map(FlowCharts.dailyMovingAverages(h.bars,{asOf:h.asOf}).series.map(b=>[b.end,b])):new Map();
 const series=aggregate.series.map(b=>({...b,sma20:averages.get(b.end)?.sma20??null,ema50:averages.get(b.end)?.ema50??null}));
 const mode=state.detailMode,hasTaker=aggregate.taker!==null,unit={'1d':'ngày','1w':'tuần','1M':'tháng'}[interval];
 const stats=stat('Giá 7 ngày',colored(d.return7))+stat('Giá 30 ngày',colored(d.return30))+stat('GD/ngày · 20 ngày',d.turnover20===null?'Thiếu lịch sử':fmt(d.turnover20/1e6,3)+' triệu USDT')+stat('Taker mua 7D',d.buyShare7===null?'Nguồn không cung cấp / thiếu':fmt(d.buyShare7*100)+'%');
 const controls='<div class="detail-controls"><div class="segmented"><button data-chart-mode="price" class="'+(mode==='price'?'selected':'')+'">Nến & volume</button><button data-chart-mode="delta" '+(!hasTaker?'disabled':'')+' class="'+(mode==='delta'?'selected':'')+'">Mua − bán chủ động</button><button data-chart-mode="cvd" '+(!hasTaker?'disabled':'')+' class="'+(mode==='cvd'?'selected':'')+'">CVD</button></div><label>Khung nến <select data-detail-interval>'+[['1d','Ngày'],['1w','Tuần'],['1M','Tháng']].map(([v,t])=>'<option value="'+v+'" '+(interval===v?'selected':'')+'>'+t+'</option>').join('')+'</select></label><label>Lịch sử <select data-detail-window>'+[30,90,120].map(n=>'<option value="'+n+'" '+(state.detailWindow===n?'selected':'')+'>'+n+' ngày</option>').join('')+'</select></label><button data-toggle-ma aria-pressed="'+state.detailMA+'">SMA20 / EMA50 '+(state.detailMA?'✓':'')+'</button></div>';
 const reset=aggregate.coverage.cvdResetAt;
 const note=mode==='price'?'Nến OHLC và giá trị giao dịch từng '+unit+' UTC (USDT).':mode==='delta'?'Cột: taker mua − taker bán, đơn vị USDT; đường vàng: giá đóng cửa, trục bên phải.':'CVD cộng dồn từ 0 trước ngày '+(reset?day(reset):'chưa có')+', chỉ trong cửa sổ đang xem. Đây là chênh lệch khớp lệnh chủ động, không phải số dư ví.';
 $('#detail-body').innerHTML='<p class="small">Nguồn '+U.NAMES[row.sourceId]+' · '+h.bars.length+' nến ngày đã đóng · Bỏ '+h.dropped+' nến ngày chưa đóng · Lấy lúc '+date(h.fetchedAt)+'</p>'+(warning?'<p class="note warning">'+esc(warning)+'</p>':'')+(!d.current?'<p class="note warning">BẢN LƯU LỊCH SỬ · Chưa có nến ngày UTC đã đóng mới nhất. Kết thúc '+day(d.latestEnd)+'.</p>':'')+(statsError?'<p class="note warning">Chuỗi ngày thiếu hoặc không liên tục: '+esc(statsError)+'. Chỉ số 7D/30D để thiếu; khung tuần/tháng chỉ vẽ các kỳ hoàn chỉnh.</p>':'')+(!aggregate.current?'<p class="small warning">Chưa có kỳ '+unit+' hoàn chỉnh mới nhất'+(aggregate.coverage.to?'; kỳ cuối '+day(aggregate.coverage.to):'')+'.</p>':'')+controls+'<div class="chart-box detail-chart">'+FlowChartsView.daily(series,{mode,interval,width:Math.max(320,$('#detail-body').clientWidth||960)})+'</div><p class="chart-note">'+note+' Hiển thị '+series.length+' nến '+unit+' hoàn chỉnh trong phạm vi '+state.detailWindow+' ngày; có '+d.coverage.days+'/'+state.detailWindow+' ngày dữ liệu. Tuần bắt đầu thứ Hai UTC; tháng theo lịch UTC. '+aggregate.excluded.length+' kỳ biên/thiếu ngày bị loại.</p>'+(mode==='price'&&state.detailMA?'<p class="small">SMA20 và EMA50 tính trên toàn bộ nến ngày sẵn có, không đặt lại khi đổi cửa sổ. Trên nến tuần/tháng lấy giá trị cuối kỳ. EMA50 bắt đầu bằng trung bình 50 ngày đầu; chưa có EMA200 vì chưa đủ 200 ngày.</p>':'')+'<div class="detail-stats">'+stats+'</div>'+(!hasTaker?'<p class="small warning">Nguồn nến '+U.NAMES[row.sourceId]+' không có dữ liệu taker đầy đủ cho cửa sổ này để tính mua/bán chủ động hoặc CVD; không thay phần thiếu bằng 0.</p>':'')+'<div class="evidence-list compact"><div><h3>Giao dịch trên sàn</h3><p>Giá và volume của đúng cặp '+esc(row.instrument)+'. Taker mô tả bên chủ động khớp lệnh; không xác định ai mua.</p></div><div><h3>Ví và tích lũy</h3><p>Chưa xác minh danh tính ví, số token còn giữ, mua/bán DEX hoặc các ví cùng chủ. Chưa kết luận cá mập tích lũy.</p></div></div><p class="small">Cùng ticker ở sàn khác chưa được coi là cùng hợp đồng token. Không tự gộp giá, volume hoặc tỷ lệ mua.</p>';
}
async function detail(key){
 const row=allRows().find(r=>r.key===key);if(!row)return;const seq=++state.detailSeq;state.detailKey=key;state.detailMode='price';state.detailWindow=120;state.detailInterval='1d';state.detailMA=true;state.detailWarning='';$('#detail-title').textContent=row.base+' / USDT · '+U.NAMES[row.sourceId];$('#detail-body').innerHTML='<p>Đang đọc nến ngày UTC đã đóng từ '+U.NAMES[row.sourceId]+'…</p><p class="small">Giá ticker: '+fmt(row.last,8)+' USDT · '+date(row.asOf)+'</p>';if(!$('#detail').open)$('#detail').showModal();
 try{let h=state.histories[key],warning='';if(!h||Date.now()-h.fetchedAt>300000){try{h=await FlowMarket.history(row.sourceId,row.instrument);state.histories[key]=h;}catch(e){if(!h)throw e;warning='Đọc mới thất bại: '+e.message+'. Đang xem lịch sử đã lấy lúc '+date(h.fetchedAt)+'.';}}
  if(seq!==state.detailSeq)return;state.detailWarning=warning;renderDetail(row,h,warning);renderCharts();log(row.key+': '+h.bars.length+' nến đã đóng, cuối ngày '+day(h.bars.at(-1).end)+'.');
 }catch(e){if(seq!==state.detailSeq)return;$('#detail-body').innerHTML='<p class="negative">Không đọc được lịch sử: '+esc(e.message)+'</p><p class="small">Giá ticker lưu trước đó: '+fmt(row.last,8)+' USDT · '+date(row.asOf)+'. Chưa có cơ sở tính chỉ số lịch sử.</p>';log(row.key+' lịch sử lỗi: '+e.message);}
}
$('#load').addEventListener('click',scan);
for(const id of ['#bubble-size','#bubble-count'])$(id).addEventListener('change',renderCharts);
$('#view-bubbles').addEventListener('click',()=>{state.overviewMode='bubbles';renderCharts();});$('#view-scatter').addEventListener('click',()=>{state.overviewMode='scatter';renderCharts();});
$('#load-history').addEventListener('click',loadHistory);$('#cancel-history').addEventListener('click',()=>{state.historyCancelled=true;});
for(const id of ['#search','#source','#sort'])$(id).addEventListener(id==='#search'?'input':'change',()=>{state.page=0;render();});
$('#prev').addEventListener('click',()=>{state.page--;render();});$('#next').addEventListener('click',()=>{state.page++;render();});
for(const id of ['#table','#overview-chart','#flow-chart']){$(id).addEventListener('click',e=>{const b=e.target.closest('[data-key]');if(b)detail(b.dataset.key);});if(id!=='#table')$(id).addEventListener('keydown',e=>{const b=e.target.closest('[data-key]');if(b&&['Enter',' '].includes(e.key)){e.preventDefault();detail(b.dataset.key);}});}
$('#detail-body').addEventListener('click',e=>{const ma=e.target.closest('[data-toggle-ma]');if(ma){state.detailMA=!state.detailMA;const r=allRows().find(r=>r.key===state.detailKey),h=state.histories[state.detailKey];if(r&&h)renderDetail(r,h,state.detailWarning);return;}const b=e.target.closest('[data-chart-mode]');if(!b||b.disabled)return;state.detailMode=b.dataset.chartMode;const row=allRows().find(r=>r.key===state.detailKey),h=state.histories[state.detailKey];if(row&&h)renderDetail(row,h,state.detailWarning);});
$('#detail-body').addEventListener('change',e=>{if(e.target.matches('[data-detail-interval]'))state.detailInterval=e.target.value;else if(e.target.matches('[data-detail-window]'))state.detailWindow=Number(e.target.value);else return;const row=allRows().find(r=>r.key===state.detailKey),h=state.histories[state.detailKey];if(row&&h)renderDetail(row,h,state.detailWarning);});
$('#close').addEventListener('click',()=>{$('#detail').close();state.detailSeq++;state.detailKey=null;});$('#detail').addEventListener('cancel',()=>{state.detailSeq++;state.detailKey=null;});
$('nav').addEventListener('click',e=>{const b=e.target.closest('[data-panel]');if(!b)return;document.querySelectorAll('.tab').forEach(n=>n.classList.toggle('active',n===b));document.querySelectorAll('.panel').forEach(n=>n.hidden=n.id!==b.dataset.panel);});
$('#export').addEventListener('click',()=>{const body={schemaVersion:1,generatedAt:Date.now(),exportedAt:Date.now(),sources:state.sources,histories:state.histories,flowSnapshot:state.flowSnapshot,note:'Public descriptive market data; no whale evidence or validated investment signal.'};const blob=new Blob([JSON.stringify(body,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='flow-research-evidence-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
setInterval(render,60000);
$('#source').innerHTML='<option value="all">Tất cả sàn đã kết nối</option>'+SOURCES.map(s=>'<option value="'+s.id+'">'+esc(s.name)+'</option>').join('');
initial();loadAuxiliary();
}
