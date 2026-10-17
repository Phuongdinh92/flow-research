/* Market presentation only. The same source identity and return window stay attached to every row. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.FlowMarketOverview=api;})(globalThis,function(){
'use strict';
const TTL=900000,MAX_SKEW=300000;
const PERIODS=Object.freeze({'1h':{field:'return1hPct',label:'1H'},'24h':{field:'return24hPct',label:'24H'},'7d':{field:'return7dPct',label:'7D'},'30d':{field:'return30dPct',label:'30D'},'1y':{field:'return1yPct',label:'1Y'}});
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=n=>!finite(n)?'—':(n>0?'+':'')+(n!==0&&Math.abs(n)<.000001?n.toExponential(3):n.toLocaleString('vi-VN',{maximumFractionDigits:n!==0&&Math.abs(n)<.01?8:2}))+'%';
const human=n=>!finite(n)?'—':Math.abs(n)>=1e9?(n/1e9).toLocaleString('vi-VN',{maximumFractionDigits:2})+'B':Math.abs(n)>=1e6?(n/1e6).toLocaleString('vi-VN',{maximumFractionDigits:2})+'M':n!==0&&Math.abs(n)<.000001?n.toExponential(3):n.toLocaleString('vi-VN',{maximumFractionDigits:n!==0&&Math.abs(n)<.01?8:2});
const fresh=(time,now)=>finite(time)&&time<=now+60000&&now-time<=TTL;
function periodInfo(period){const p=PERIODS[period];if(!p)throw Error('Khung biến động không được hỗ trợ');return p;}
/* A long catalog crawl is not an atomic price snapshot. Captured mode checks each
   observation against its original receipt; current mode never silently falls back. */
function selectGlobal(rows,{query='',period='24h',limit=40,now=Date.now(),sort='marketcap',minVolume=0,freshness='captured',benchmarksByBatch=null}={}){
 const p=periodInfo(period),q=query.trim().toLowerCase();
 if(!Array.isArray(rows)||!['captured','current'].includes(freshness))throw Error('Phạm vi thời điểm không hợp lệ');
 const matching=rows.filter(r=>r&&(!q||[r.id,r.symbol,r.name].some(v=>String(v).toLowerCase().includes(q))));
 const reference=r=>freshness==='captured'?r.fetchedAt:now;
 const valid=(r,volume=minVolume)=>r&&r.sourceId==='coingecko'&&r.key==='coingecko:'+r.id&&finite(r[p.field])&&r[p.field]>=-100&&finite(r.volume24hUsd)&&r.volume24hUsd>0&&r.volume24hUsd>=volume&&fresh(r.providerUpdatedAt,reference(r));
 const available=matching.filter(r=>valid(r)).map(r=>({...r,key:'coingecko:'+r.id,sourceId:'coingecko',sourceName:'CoinGecko',base:r.symbol.toUpperCase(),instrument:r.id,quote:'USD',x:r[p.field]/100,y:r.volume24hUsd,last:r.priceUsd,asOf:r.providerUpdatedAt,windowLabel:p.label}));
 const legacy=rows.find(r=>r.id==='bitcoin'&&!r.sourceBatch&&valid(r,0));
 const normalize=(r,batchId=null)=>r&&r.id==='bitcoin'&&valid(r,0)?{key:'coingecko:bitcoin',sourceId:'coingecko',instrument:'bitcoin',returnPct:r[p.field],asOf:r.providerUpdatedAt,fetchedAt:r.fetchedAt,sourceBatch:batchId,sourceSha256:r.sourceSha256||null,windowLabel:p.label}:null;
 const normalizedBTC=normalize(legacy),used=new Map();
 for(const r of available){
  let b=null;
  if(r.sourceBatch){const anchor=benchmarksByBatch instanceof Map?benchmarksByBatch.get(r.sourceBatch):benchmarksByBatch?.[r.sourceBatch];if(anchor&&anchor.sourceBatch===r.sourceBatch&&anchor.sourceSha256===r.sourceSha256)b=normalize(anchor,r.sourceBatch);}
  else b=normalizedBTC;
  r.benchmark=b;r.benchmarkComparable=!!b&&Math.abs(r.asOf-b.asOf)<=MAX_SKEW;r.relativeToBTCPct=r.benchmarkComparable?r.x*100-b.returnPct:null;
  if(b)used.set(b.sourceBatch||'legacy',b);
 }
 const sorts={marketcap:(a,b)=>(b.marketCapUsd||0)-(a.marketCapUsd||0),volume:(a,b)=>b.y-a.y,gainers:(a,b)=>b.x-a.x,losers:(a,b)=>a.x-b.x,absolute:(a,b)=>Math.abs(b.x)-Math.abs(a.x)};
 if(!sorts[sort])throw Error('Thứ tự không được hỗ trợ');available.sort((a,b)=>sorts[sort](a,b)||a.key.localeCompare(b.key));
 const comparable=available.filter(r=>r.benchmarkComparable).length;
 return {matching:matching.length,available:available.length,missing:matching.length-available.length,rows:available.slice(0,limit==='all'?available.length:Math.min(400,Math.max(1,Math.floor(Number(limit)||40)))),allRows:available,benchmark:normalizedBTC,benchmarks:[...used.values()],benchmarkComparable:comparable,benchmarkUnavailable:available.length-comparable,period,label:p.label,freshness};
}
/* Pagination bounds browser work without changing which IDs belong to the universe. */
function pageRows(rows,{limit='all',page=1,allPageSize=200,maxItems=400}={}){
 if(!Array.isArray(rows)||!Number.isInteger(allPageSize)||allPageSize<1||allPageSize>400||!Number.isInteger(maxItems)||maxItems<1||maxItems>400)throw Error('Phân trang không hợp lệ');
 const all=limit==='all',pageSize=all?allPageSize:Math.min(maxItems,Math.max(1,Math.floor(Number(limit)||40))),total=rows.length,pages=all?Math.max(1,Math.ceil(total/pageSize)):1,current=Math.min(pages,Math.max(1,Math.floor(Number(page)||1))),start=all?(current-1)*pageSize:0;
 return {rows:rows.slice(start,start+pageSize),page:current,pages,pageSize,total,start,end:Math.min(total,start+pageSize),all};
}
function selectCatalog(ledger,{query='',status='all',now=Date.now(),freshness='captured',pricedRows=[]}={}){
 if(!ledger||!Array.isArray(ledger.entries)||!['captured','current'].includes(freshness))throw Error('Danh mục chưa được xác minh');
 const q=query.trim().toLowerCase(),checkFreshness=Array.isArray(pricedRows),prices=new Map((pricedRows||[]).map(r=>[r.id,r])),known=['all','priced','stale','no_quote','missing','invalid','error','unattempted'];if(!known.includes(status))throw Error('Trạng thái danh mục không hợp lệ');
 return ledger.entries.filter(r=>{const values=[r.id,r.symbol,r.name,...Object.entries(r.platforms||{}).flat()];if(q&&!values.some(v=>String(v).toLowerCase().includes(q)))return false;const price=prices.get(r.id),stale=checkFreshness&&r.status==='priced'&&(!price||!fresh(price.providerUpdatedAt,freshness==='captured'?price.fetchedAt:now));return status==='all'||(status==='stale'?stale:r.status===status);}).map(r=>{const price=prices.get(r.id)||null;return {...r,price,stale:checkFreshness&&r.status==='priced'&&(!price||!fresh(price.providerUpdatedAt,freshness==='captured'?price.fetchedAt:now))};});
}
function selectVenue(rows,{now=Date.now()}={}){
 const available=rows.filter(r=>r&&typeof r.sourceId==='string'&&r.key===r.sourceId+':'+r.instrument&&finite(r.return24)&&r.return24>=-1&&finite(r.turnover24)&&r.turnover24>0&&fresh(r.asOf,now));
 const exact={binance:'BTCUSDT',bitget:'BTCUSDT',gate:'BTC_USDT',whitebit:'BTC_USDT'},benchmarks=new Map();
 for(const r of available)if(exact[r.sourceId]===r.instrument&&r.base==='BTC')benchmarks.set(r.sourceId,{key:r.key,sourceId:r.sourceId,instrument:r.instrument,returnPct:r.return24*100,asOf:r.asOf,windowLabel:'24H'});
 return available.map(r=>{const b=benchmarks.get(r.sourceId)||null,comparable=!!b&&Math.abs(r.asOf-b.asOf)<=MAX_SKEW;return {...r,x:r.return24,y:r.turnover24,quote:'USDT',windowLabel:'24H',benchmark:b,benchmarkComparable:comparable,relativeToBTCPct:comparable?(r.return24*100-b.returnPct):null};});
}
function movers(rows,{count=10}={}){const n=Math.max(1,Math.floor(count));return {gainers:rows.filter(r=>r.x>0).sort((a,b)=>b.x-a.x||a.key.localeCompare(b.key)).slice(0,n),losers:rows.filter(r=>r.x<0).sort((a,b)=>a.x-b.x||a.key.localeCompare(b.key)).slice(0,n)};}
function countertrend(rows){return rows.filter(r=>r.benchmarkComparable&&r.key!==r.benchmark.key&&r.x!==0&&r.benchmark.returnPct!==0&&Math.sign(r.x)!==Math.sign(r.benchmark.returnPct)).sort((a,b)=>Math.abs(b.relativeToBTCPct)-Math.abs(a.relativeToBTCPct)||a.key.localeCompare(b.key));}
function bubbleGrid(rows,{sizeBy='equal',windowLabel='24H'}={}){
 if(!['equal','turnover'].includes(sizeBy)||!Array.isArray(rows)||rows.some(r=>!r||!finite(r.x)||!finite(r.y)||r.y<=0||typeof r.key!=='string'))throw Error('Dữ liệu bóng không hợp lệ');
 const max=Math.max(...rows.map(r=>r.y))||1;
 return '<div class="market-bubble-grid" aria-label="Tất cả tài sản · biến động '+esc(windowLabel)+'">'+rows.map(r=>{const radius=sizeBy==='equal'?34:34*Math.sqrt(r.y/max);return '<button type="button" class="market-bubble-tile '+(r.x>0?'bubble-up':r.x<0?'bubble-down':'bubble-flat')+'" data-key="'+esc(r.key)+'" title="'+esc(r.instrument+' · '+r.sourceName+' · '+pct(r.x*100)+' · GD 24H '+r.y+' '+r.quote+' · '+new Date(r.asOf).toISOString())+'"><svg viewBox="0 0 88 78" aria-hidden="true"><circle cx="44" cy="39" r="'+radius+'"/></svg><strong>'+esc(r.base)+'</strong><em>'+pct(r.x*100)+'</em><small>'+esc(r.sourceName)+'</small></button>';}).join('')+'</div>';
}
function rowHTML(r,{benchmark=false}={}){const positive=r.x>0?'positive':r.x<0?'negative':'';return '<button type="button" class="market-list-row" data-key="'+esc(r.key)+'" title="'+esc(r.instrument+' · '+r.sourceName+' · '+new Date(r.asOf).toISOString())+'"><span><strong>'+esc(r.base)+'</strong><small>'+esc(r.sourceName)+' · '+esc(r.instrument)+'</small></span><span class="'+positive+'">'+pct(r.x*100)+(benchmark?'<small>BTC '+pct(r.benchmark.returnPct)+' · chênh '+(r.relativeToBTCPct>0?'+':'')+r.relativeToBTCPct.toLocaleString('vi-VN',{maximumFractionDigits:2})+' điểm %</small>':'<small>'+human(r.y)+' '+esc(r.quote)+' · GD 24H</small>')+'</span></button>';}
function render(rows,{mode='columns',limit=40,windowLabel='24H'}={}){
 if(!Array.isArray(rows)||rows.some(r=>!r||!finite(r.x)||!finite(r.y)||r.y<=0||typeof r.key!=='string'))throw Error('Dữ liệu trình bày không hợp lệ');
 if(!rows.length)return '<p class="chart-empty">Không có tài sản đủ dữ liệu trong phạm vi đã chọn.</p>';
 const selected=rows.slice(0,limit==='all'?rows.length:Math.max(1,Math.floor(Number(limit)||40)));
 if(mode==='movers'){const m=movers(rows);return '<div class="market-movers"><section><h3>Tăng mạnh · '+esc(windowLabel)+'</h3>'+(m.gainers.map(r=>rowHTML(r)).join('')||'<p>Không có mã tăng.</p>')+'</section><section><h3>Giảm mạnh · '+esc(windowLabel)+'</h3>'+(m.losers.map(r=>rowHTML(r)).join('')||'<p>Không có mã giảm.</p>')+'</section></div>';}
 if(mode==='countertrend'){const c=countertrend(rows);return '<div class="market-countertrend"><p class="small">Giá đi ngược dấu với BTC trong cùng khung. Chỉ so nguồn giống nhau, lệch thời điểm tối đa 5 phút. Chênh lệch là điểm phần trăm; chưa phải lợi suất đã điều chỉnh rủi ro.</p>'+(!c.length?'<p class="chart-empty">Không có mã đi ngược BTC, hoặc BTC/khung nguồn chưa đủ dữ liệu.</p>':c.slice(0,limit==='all'?c.length:Number(limit)||40).map(r=>rowHTML(r,{benchmark:true})).join(''))+'</div>';}
 if(mode!=='columns')throw Error('Chế độ trình bày không hợp lệ');
 const max=Math.max(...selected.map(r=>Math.abs(r.x)))||1;
 return '<div class="market-columns" aria-label="Cột biến động giá '+esc(windowLabel)+'"><p class="small">Đường giữa = 0%. Chiều dài cột tỷ lệ trị tuyệt đối biến động, cùng một thang cho toàn bộ danh sách đang hiện.</p>'+selected.map(r=>'<button type="button" class="market-column-row" data-key="'+esc(r.key)+'"><span class="market-column-label"><strong>'+esc(r.base)+'</strong><small>'+esc(r.sourceName)+'</small></span><span class="market-column-track"><i class="'+(r.x>=0?'market-column-up':'market-column-down')+'" style="width:'+(Math.abs(r.x)/max*50).toFixed(5)+'%"></i></span><strong class="'+(r.x>=0?'positive':'negative')+'">'+pct(r.x*100)+'</strong></button>').join('')+'</div>';
}
function parseCategories(raw,{fetchedAt=Date.now(),now=Date.now()}={}){
 if(!Array.isArray(raw)||!finite(fetchedAt)||!finite(now))throw Error('Nguồn nhóm ngành sai định dạng');
 const rows=[],errors=[],seen=new Set();
 for(const r of raw)try{if(!r||typeof r.id!=='string'||!r.id||typeof r.name!=='string'||!r.name||seen.has(r.id))throw Error('Định danh nhóm trùng hoặc thiếu');seen.add(r.id);const updatedAt=Date.parse(r.updated_at);if(!finite(updatedAt)||updatedAt>now+60000)throw Error('Thời điểm nguồn không hợp lệ');for(const k of ['market_cap','volume_24h'])if(!finite(r[k])||r[k]<0)throw Error('Thiếu vốn hóa/volume');if(!finite(r.market_cap_change_24h)||r.market_cap_change_24h< -100)throw Error('Thiếu biến động vốn hóa');if(!Array.isArray(r.top_3_coins_id)||r.top_3_coins_id.some(id=>typeof id!=='string'||!id))throw Error('Thiếu định danh tài sản đại diện');rows.push({id:r.id,name:r.name,marketCapUsd:r.market_cap,marketCapChange24hPct:r.market_cap_change_24h,volume24hUsd:r.volume_24h,topCoinIds:[...new Set(r.top_3_coins_id)].slice(0,3),providerUpdatedAt:updatedAt,fetchedAt});}catch(e){errors.push({id:r?.id??null,message:e.message});}
 return {rows,errors,inputCount:raw.length,fetchedAt};
}
function validateCategories(raw){if(!raw||raw.schemaVersion!==1||raw.provider!=='CoinGecko'||raw.currency!=='USD'||!finite(raw.generatedAt)||!Array.isArray(raw.rows)||!raw.source||typeof raw.source.url!=='string'||!/^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/categories\?/.test(raw.source.url)||!Number.isInteger(raw.source.inputCount)||raw.source.inputCount<raw.rows.length||!/^[a-f0-9]{64}$/.test(raw.source.sha256))throw Error('Bản nhóm ngành không hợp lệ');const seen=new Set();for(const r of raw.rows){if(typeof r.id!=='string'||!r.id||seen.has(r.id)||typeof r.name!=='string'||!r.name)throw Error('Nhóm ngành thiếu/trùng định danh');seen.add(r.id);if(!finite(r.marketCapUsd)||r.marketCapUsd<0||!finite(r.volume24hUsd)||r.volume24hUsd<0||!finite(r.marketCapChange24hPct)||r.marketCapChange24hPct< -100||!finite(r.providerUpdatedAt)||!finite(r.fetchedAt)||r.providerUpdatedAt>r.fetchedAt+60000||!Array.isArray(r.topCoinIds)||r.topCoinIds.some(id=>typeof id!=='string'||!id))throw Error('Số liệu nhóm ngành không hợp lệ');}return raw;}
 return {TTL,MAX_SKEW,PERIODS,periodInfo,selectGlobal,pageRows,selectCatalog,selectVenue,movers,countertrend,bubbleGrid,render,parseCategories,validateCategories,esc,pct,human};
});
