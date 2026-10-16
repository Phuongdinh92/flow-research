/* Public descriptive market UI. No private signal model, wallet labels, or trading. */
(function(root){
'use strict';
const DAY=86400000,TTL=900000;
const NAMES={binance:'Binance',bitget:'Bitget'};
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
 const q=query.trim().toUpperCase();const rows=sources.flatMap(s=>s.rows.map(r=>({...r,mode:s.mode,stale:now-r.asOf>TTL,lastAttemptError:s.lastAttemptError||null}))).filter(r=>(source==='all'||r.sourceId===source)&&(!q||r.base.toUpperCase().includes(q)||r.instrument.includes(q)));
 return rows.sort((a,b)=>sort==='base'?a.base.localeCompare(b.base)||a.sourceId.localeCompare(b.sourceId):(b[sort]-a[sort])||a.key.localeCompare(b.key));
}
const api={summarize,validateSnapshot,rowsFor,TTL,NAMES};root.FlowUI=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);

if(typeof document!=='undefined'){
'use strict';
const U=FlowUI,$=s=>document.querySelector(s),SIZE=50;
const state={sources:[],busy:false,page:0,cooldown:0,detailSeq:0,histories:{},revision:0};
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
function render(){
 const rows=allRows(),valid=state.sources.filter(s=>s.rows.length),fresh=valid.filter(s=>s.rows.every(r=>Date.now()-r.asOf<=U.TTL));
 $('#count').textContent=fmt(rows.length,0);$('#source-count').textContent=valid.length+' / 2';$('#coverage-sub').textContent=fresh.length+' nguồn có ticker trong 15 phút';
 const latest=rows.length?Math.max(...rows.map(r=>r.asOf)):null;$('#asof').textContent=latest?age(latest):'Chưa có';$('#fetched').textContent=latest?date(latest)+' · giờ Việt Nam':'Thời điểm do nguồn ghi nhận';$('#export').disabled=!rows.length;
 $('#coverage').innerHTML=['binance','bitget'].map(id=>{
  const s=state.sources.find(x=>x.sourceId===id);
  if(!s)return '<article class="source-card"><div class="card-head"><strong>'+U.NAMES[id]+'</strong><span class="pill">'+(state.busy?'Đang đọc…':'Chưa có dữ liệu')+'</span></div><p class="small">Cần phản hồi hợp lệ từ danh mục và ticker.</p></article>';
  const stale=s.rows.filter(r=>Date.now()-r.asOf>U.TTL).length,label=s.rows.length?(s.mode==='saved'?'Bản lưu':'Đã đọc trực tiếp'):'Đọc thất bại';
  return '<article class="source-card"><div class="card-head"><strong>'+esc(s.name)+'</strong><span class="pill '+(s.rows.length&&!stale&&!s.lastAttemptError?'positive':'warning')+'">'+label+(stale?' · có dữ liệu cũ':'')+'</span></div><div class="source-number">'+fmt(s.rows.length,0)+' <span>/ '+fmt(s.instrumentCount,0)+' cặp hợp lệ</span></div><p class="small">USDT · '+(s.asOf?date(s.asOf)+' · '+age(s.asOf):'Chưa có thời điểm nguồn')+'</p>'+(stale?'<p class="small warning">'+stale+' cặp có ticker quá 15 phút.</p>':'')+(s.lastAttemptError?'<p class="small negative">Lần đọc mới lỗi: '+esc(s.lastAttemptError)+'</p>':'')+(s.errors?.length?'<details><summary>'+s.errors.length+' ghi nhận chất lượng</summary><p class="small">'+s.errors.slice(0,12).map(x=>esc(typeof x==='string'?x:JSON.stringify(x))).join('<br>')+'</p></details>':'')+'</article>';
 }).join('');
 const filtered=U.rowsFor(state.sources,{query:$('#search').value,source:$('#source').value,sort:$('#sort').value}),pages=Math.max(1,Math.ceil(filtered.length/SIZE));state.page=Math.min(state.page,pages-1);const shown=filtered.slice(state.page*SIZE,(state.page+1)*SIZE);
 $('#prev').disabled=state.page===0;$('#next').disabled=state.page>=pages-1;$('#page-info').textContent=filtered.length?fmt(filtered.length,0)+' cặp khớp bộ lọc · Trang '+(state.page+1)+' / '+pages:'Không có cặp khớp bộ lọc';
 if(!shown.length){$('#table').className='empty';$('#table').innerHTML='<strong>'+(!rows.length?'Chưa có dữ liệu hợp lệ':'Không tìm thấy cặp')+'</strong><p>'+(!rows.length?'Bấm quét mới để kiểm tra nguồn công khai.':'Thử tên mã hoặc chọn lại nguồn.')+'</p>';return;}
 $('#table').className='table-scroll';$('#table').innerHTML='<table><thead><tr><th>Cặp / Sàn</th><th>Giá · USDT</th><th>Giá 24H</th><th>GD 24H · triệu USDT</th><th>Thời điểm nguồn</th></tr></thead><tbody>'+shown.map(r=>'<tr><td><button class="asset" data-key="'+esc(r.key)+'">'+esc(r.base)+' / USDT ↗</button><div class="row-note">'+U.NAMES[r.sourceId]+' · '+esc(r.instrument)+'</div></td><td>'+fmt(r.last,8)+'</td><td>'+colored(r.return24)+'</td><td>'+fmt(r.turnover24/1e6,3)+'</td><td><span class="'+(r.stale?'warning':'muted')+'">'+(r.stale?'Cũ · ':'')+age(r.asOf)+'</span><div class="row-note">'+(r.mode==='saved'?'Bản lưu':'API trực tiếp')+'</div></td></tr>').join('')+'</tbody></table>';
}
async function initial(){
 const revision=state.revision;
 render();try{const r=await fetch('data/market-snapshot.json',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(state.revision!==revision)return;state.sources=U.validateSnapshot(data);render();status('Đã mở bản lưu có nguồn gốc: '+fmt(allRows().length,0)+' cặp/sàn. Bấm “Quét dữ liệu mới” để cập nhật; thời điểm của từng nguồn hiển thị bên dưới.');log('Mở bản lưu lấy lúc '+date(data.generatedAt)+'. Không coi bản lưu là lần gọi API mới.');}
 catch(e){if(state.revision!==revision)return;status('Chưa đọc được bản lưu. Bấm “Quét dữ liệu mới” để lấy dữ liệu từ nguồn.');log('Bản lưu: '+e.message);}
}
async function scan(){
 if(state.busy)return;if(Date.now()<state.cooldown){status('Thử quét lại sau '+Math.ceil((state.cooldown-Date.now())/1000)+' giây.','error');return;}
 state.revision++;state.busy=true;$('#load').disabled=true;status('Đang khám phá danh mục và đọc ticker từ Binance, Bitget…');render();let successes=0;
 const attempts=await Promise.allSettled(['binance','bitget'].map(async id=>{
  const s=await FlowMarket.scanSource(id);if(!s.rows.length)throw Error('Không có cặp hợp lệ.');
  return {...s,asOf:Math.min(...s.rows.map(r=>r.asOf)),mode:'live',lastAttemptError:null,status:s.errors?.length?'partial':'ok'};
 }));
 attempts.forEach((r,i)=>{
  const id=['binance','bitget'][i],old=state.sources.find(s=>s.sourceId===id);
  if(r.status==='fulfilled'){successes++;state.sources=state.sources.filter(s=>s.sourceId!==id).concat(r.value);log(U.NAMES[id]+': '+r.value.rows.length+'/'+r.value.instrumentCount+' cặp hợp lệ, '+(r.value.errors?.length||0)+' ghi nhận chất lượng.');}
  else {const error=r.reason?.message||String(r.reason);if(old)old.lastAttemptError=error;else state.sources.push({sourceId:id,name:U.NAMES[id],asOf:null,fetchedAt:Date.now(),instrumentCount:0,rows:[],errors:[error],lastAttemptError:error,mode:'live',status:'error'});log(U.NAMES[id]+': '+error+'. Không tạo dữ liệu thay thế.');}
 });
 state.busy=false;state.cooldown=Date.now()+Math.max(30000,...attempts.map(r=>r.status==='rejected'?(r.reason.retryAfterMs||0):0));$('#load').disabled=false;render();status('Đã đọc mới '+successes+'/2 nguồn · '+fmt(allRows().length,0)+' cặp/sàn có dữ liệu. '+(successes<2?'Nguồn bị lỗi giữ nguyên nhãn dữ liệu cũ/bản lưu, nếu có. ':'')+'Chưa có bằng chứng ví để xác nhận cá mập.',successes===2?'ok':'error');
}
function priceChart(bars){
 if(bars.length<2)return '<p class="small">Chưa đủ nến để vẽ.</p>';
 const W=760,H=240,L=70,R=18,T=20,B=30,values=bars.map(b=>b.close),lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo||hi)*.08,mn=lo-pad,mx=hi+pad,X=i=>L+i*(W-L-R)/(bars.length-1),Y=v=>T+(mx-v)/(mx-mn)*(H-T-B);
 let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Giá đóng cửa ngày UTC">';
 for(let i=0;i<4;i++){const v=mn+(mx-mn)*i/3;s+='<line class="grid" x1="'+L+'" y1="'+Y(v)+'" x2="'+(W-R)+'" y2="'+Y(v)+'"/><text text-anchor="end" x="'+(L-9)+'" y="'+(Y(v)+4)+'">'+v.toPrecision(4)+'</text>';}
 return s+'<path class="price-line" d="'+bars.map((v,i)=>(i?'L':'M')+X(i).toFixed(2)+','+Y(v.close).toFixed(2)).join(' ')+'"/><text x="'+L+'" y="'+(H-4)+'">'+day(bars[0].time)+'</text><text text-anchor="end" x="'+(W-R)+'" y="'+(H-4)+'">'+day(bars.at(-1).end)+'</text></svg>';
}
function stat(label,value){return '<p><span>'+esc(label)+'</span><strong>'+value+'</strong></p>';}
async function detail(key){
 const row=allRows().find(r=>r.key===key);if(!row)return;const seq=++state.detailSeq;$('#detail-title').textContent=row.base+' / USDT · '+U.NAMES[row.sourceId];$('#detail-body').innerHTML='<p>Đang đọc nến ngày UTC đã đóng từ '+U.NAMES[row.sourceId]+'…</p><p class="small">Giá ticker: '+fmt(row.last,8)+' USDT · '+date(row.asOf)+'</p>';if(!$('#detail').open)$('#detail').showModal();
 try{let h=state.histories[key];if(!h||Date.now()-h.fetchedAt>300000){h=await FlowMarket.history(row.sourceId,row.instrument);state.histories[key]=h;}
  if(seq!==state.detailSeq)return;let summary,issue='';try{summary=U.summarize(h.bars,h.asOf);}catch(e){issue=e.message;}
  const stats=summary?stat('Giá 7 ngày',colored(summary.return7))+stat('Giá 30 ngày',colored(summary.return30))+stat('GD/ngày · 20 ngày',fmt(summary.turnover/1e6,3)+' triệu USDT')+stat('Taker mua 7D',summary.buyShare===null?'Nguồn không cung cấp':fmt(summary.buyShare*100)+'%'):'';
  $('#detail-body').innerHTML='<p class="small">'+h.bars.length+' nến đã đóng · Bỏ '+h.dropped+' nến chưa đóng · Nguồn lúc '+date(h.asOf)+'</p><div class="chart-box">'+priceChart(h.bars)+'</div>'+(issue?'<p class="note warning">'+esc(issue)+'</p>':'<div class="detail-stats">'+stats+'</div>')+'<div class="evidence-list compact"><div><h3>Giao dịch trên sàn</h3><p>Đã đọc giá và khối lượng của đúng cặp '+esc(row.instrument)+'. '+(row.sourceId==='binance'?'Taker mua mô tả bên chủ động khớp lệnh; không xác định ai mua.':'Nguồn nến này không có tỷ trọng chủ động mua; không thay phần thiếu bằng 0.')+'</p></div><div><h3>Ví và tích lũy</h3><p>Chưa xác minh danh tính ví, mua/bán DEX, số token còn giữ hoặc các ví có cùng chủ. Chưa kết luận tích lũy.</p></div></div><p class="small">Cùng ticker trên sàn khác chưa được coi là cùng hợp đồng token. Không tự gộp giá, volume hoặc tỷ lệ mua.</p><p class="small">Lịch sử được đọc trực tiếp khi mở chi tiết, không phải ảnh chụp biểu đồ.</p>';
  log(U.NAMES[row.sourceId]+' '+row.instrument+': '+h.bars.length+' nến đã đóng; '+(issue||'chuỗi 31 ngày liên tục hợp lệ')+'.');
 }catch(e){if(seq!==state.detailSeq)return;$('#detail-body').innerHTML='<p class="negative">Không đọc được lịch sử: '+esc(e.message)+'</p><p class="small">Giá ticker lưu trước đó: '+fmt(row.last,8)+' USDT · '+date(row.asOf)+'. Chưa có cơ sở tính chỉ số lịch sử.</p>';log(row.key+' lịch sử lỗi: '+e.message);}
}
$('#load').addEventListener('click',scan);
for(const id of ['#search','#source','#sort'])$(id).addEventListener(id==='#search'?'input':'change',()=>{state.page=0;render();});
$('#prev').addEventListener('click',()=>{state.page--;render();});$('#next').addEventListener('click',()=>{state.page++;render();});
$('#table').addEventListener('click',e=>{const b=e.target.closest('[data-key]');if(b)detail(b.dataset.key);});
$('#close').addEventListener('click',()=>{$('#detail').close();state.detailSeq++;});$('#detail').addEventListener('cancel',()=>state.detailSeq++);
$('nav').addEventListener('click',e=>{const b=e.target.closest('[data-panel]');if(!b)return;document.querySelectorAll('.tab').forEach(n=>n.classList.toggle('active',n===b));document.querySelectorAll('.panel').forEach(n=>n.hidden=n.id!==b.dataset.panel);});
$('#export').addEventListener('click',()=>{const body={schemaVersion:1,generatedAt:Date.now(),exportedAt:Date.now(),sources:state.sources,histories:state.histories,note:'Public descriptive market data; no whale evidence or validated investment signal.'};const blob=new Blob([JSON.stringify(body,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='flow-research-evidence-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
setInterval(render,60000);
initial();
}
