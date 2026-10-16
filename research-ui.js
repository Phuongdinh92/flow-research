/* Public descriptive research interface. No private strategy, A1 model or wallet attribution. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else{root.FlowResearch=api;api.init();}})(globalThis,function(){
'use strict';
const DAY=86400000,SIZE=25;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(x,d=2)=>Number.isFinite(x)?x.toLocaleString('vi-VN',{maximumFractionDigits:d}):'Thiếu';
const pct=x=>Number.isFinite(x)?(x>0?'+':'')+fmt(x*100)+'%':'Thiếu';
const share=x=>Number.isFinite(x)?fmt(x*100)+'%':'Thiếu';
const money=x=>Number.isFinite(x)?fmt(x/1e6,3)+' triệu USDT':'Thiếu';
const date=t=>new Date(t).toISOString().replace('T',' ').replace(/\.\d+Z$/,' UTC');
const day=t=>new Date(t).toISOString().slice(0,10);
const n=x=>typeof x==='number'&&Number.isFinite(x);
function checkManifest(m,now=Date.now()){
 if(!m||m.schemaVersion!==1||m.kind!=='cex-research-manifest'||m.sourceId!=='binance'||m.collectionState!=='complete')throw Error('Bản thu thập chưa hoàn tất hoặc sai định dạng.');
 if(!n(m.generatedAt)||m.generatedAt>now+60000||!Number.isInteger(m.endTime)||m.endTime%DAY!==DAY-1||m.endTime>=now)throw Error('Thời gian bản nghiên cứu không hợp lệ.');
 const p=m.snapshot;if(!p||p.url!=='./data/research-snapshot.json.gz'||p.compression!=='gzip'||!Number.isSafeInteger(p.bytes)||p.bytes<1||p.bytes>40000000||!Number.isSafeInteger(p.decodedBytes)||p.decodedBytes<1||p.decodedBytes>120000000||!/^[a-f0-9]{64}$/.test(p.sha256)||!/^[a-f0-9]{64}$/.test(p.decodedSha256))throw Error('Thiếu định danh hoặc mã băm dữ liệu.');
 return m;
}
function validateDataset(raw,manifest,now=Date.now()){
 checkManifest(manifest,now);
 if(!raw||raw.schemaVersion!==1||raw.kind!=='cex-research'||raw.sourceId!=='binance'||raw.collectionState!=='complete'||raw.generatedAt!==manifest.generatedAt||raw.endTime!==manifest.endTime||raw.requestedDays!==401)throw Error('Tệp nến khác hồ sơ thu thập.');
 const u=raw.universe,c=raw.sourceCoverage;if(!u||!Array.isArray(u.instruments)||!c||!raw.histories||Array.isArray(raw.histories)||typeof raw.histories!=='object')throw Error('Thiếu danh mục hoặc lịch sử.');
 for(const k of['eligible','attempted','completed','fullLength','shortHistory','errors','unattempted'])if(!Number.isSafeInteger(c[k])||c[k]<0||c[k]!==manifest.sourceCoverage?.[k])throw Error('Độ phủ thu thập sai số đếm hoặc không khớp hồ sơ.');
 if(c.eligible!==u.instruments.length||u.eligibleInstrumentCount!==u.instruments.length||c.completed!==Object.keys(raw.histories).length||c.completed+c.errors+c.unattempted!==c.eligible||c.attempted!==c.completed+c.errors||c.fullLength+c.shortHistory!==c.completed||c.unattempted!==0)throw Error('Độ phủ thu thập không khớp.');
 const map=new Map();for(const r of u.instruments){if(!r||typeof r.instrument!=='string'||!/^[\p{L}\p{N}_.-]{1,80}$/u.test(r.instrument)||r.key!=='binance:'+r.instrument||r.quote!=='USDT'||typeof r.base!=='string'||!r.base||map.has(r.key))throw Error('Danh mục trùng hoặc sai định danh.');map.set(r.key,r);}
 for(const [key,h]of Object.entries(raw.histories)){
  const r=map.get(key);if(!r||h.key!==key||h.sourceId!=='binance'||h.instrument!==r.instrument||h.base!==r.base||h.quote!=='USDT'||!Array.isArray(h.bars)||!h.bars.length||h.bars.length>401||!n(h.fetchedAt)||h.fetchedAt>now+60000)throw Error('Lịch sử không khớp cặp nguồn: '+key);
  const proof=Array.isArray(h.provenance)?h.provenance:[h.provenance];if(!proof.length)throw Error('Thiếu nguồn nến: '+key);
  for(const p of proof){let url;try{url=new URL(p.url);}catch(_){throw Error('URL nguồn không hợp lệ.');}const params=[...url.searchParams.keys()];if(url.origin!=='https://data-api.binance.vision'||url.username||url.password||url.hash||url.pathname!=='/api/v3/klines'||new Set(params).size!==params.length||params.some(k=>!['symbol','interval','limit','endTime'].includes(k))||url.searchParams.get('symbol')!==r.instrument||url.searchParams.get('interval')!=='1d'||Number(url.searchParams.get('endTime'))!==raw.endTime||!Number.isInteger(Number(url.searchParams.get('limit')))||Number(url.searchParams.get('limit'))<401||Number(url.searchParams.get('limit'))>1000||!/^[a-f0-9]{64}$/.test(p.sha256)||p.httpStatus!==200)throw Error('Nguồn nến không khớp: '+key);}
  if(h.bars.at(-1).end!==raw.endTime)throw Error('Ngày nến cuối không khớp hồ sơ: '+key);
 }
 return raw;
}
async function sha(bytes){if(!globalThis.crypto?.subtle)throw Error('Trình duyệt chưa hỗ trợ kiểm tra SHA-256.');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function loadDataset(fetcher=fetch){
 const options={credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(60000)};
 const mr=await fetcher('./data/research-manifest.json',options);if(!mr.ok)throw Error('Hồ sơ HTTP '+mr.status);const manifest=checkManifest(await mr.json());
 const r=await fetcher(manifest.snapshot.url,options);if(!r.ok)throw Error('Nến HTTP '+r.status);const bytes=await r.arrayBuffer();
 if(bytes.byteLength!==manifest.snapshot.bytes||await sha(bytes)!==manifest.snapshot.sha256)throw Error('Mã băm tệp nến không khớp.');
 if(typeof DecompressionStream!=='function')throw Error('Trình duyệt chưa hỗ trợ đọc tệp nến nén. Cần trình duyệt mới hơn.');
 const decoded=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 if(decoded.byteLength!==manifest.snapshot.decodedBytes||await sha(decoded)!==manifest.snapshot.decodedSha256)throw Error('Mã băm dữ liệu giải nén không khớp.');
 return {manifest,data:validateDataset(JSON.parse(new TextDecoder().decode(decoded)),manifest)};
}
function analyzeAll(data,S,{criteria,now=Date.now()}={}){
 const analyses=[],errors=[];for(const h of Object.values(data.histories)){try{const {series,seriesFull,...a}=S.analyze(h,{criteria,now,windowDays:365});analyses.push(a);}catch(e){errors.push({key:h.key,message:e.message});}}
 return {analyses,errors};
}
function selectRows(analyses,{query='',scope='candidate',sort='delta7',page=0,excludeKnown=false}={}){
 const q=query.trim().toUpperCase();let rows=analyses.filter(a=>(!excludeKnown||!a.instrumentClass?.excludedByDefault)&&(!q||a.base.toUpperCase().includes(q)||a.instrument.toUpperCase().includes(q))&&(scope==='all'||scope==='candidate'&&a.candidate===true||scope==='eligible'&&a.candidate!==null));
 rows.sort((a,b)=>{const av=a.metrics[sort],bv=b.metrics[sort];return n(av)&&n(bv)?bv-av||a.key.localeCompare(b.key):n(av)?-1:n(bv)?1:a.key.localeCompare(b.key);});
 const pages=Math.max(1,Math.ceil(rows.length/SIZE));page=Math.max(0,Math.min(page,pages-1));return {rows,count:rows.length,page,pages,shown:rows.slice(page*SIZE,(page+1)*SIZE)};
}
function scatter(analyses,{width=1100}={}){
 const points=analyses.filter(a=>n(a.metrics.return30)&&n(a.metrics.buyShare7));if(!points.length)return '<div class="chart-empty">Chưa có cặp đủ dữ liệu 30D và taker 7D.</div>';
 const w=Math.max(360,Math.min(1400,width)),h=370,l=65,r=w-25,t=30,b=310;
 let lo=Math.min(-.15,...points.map(a=>a.metrics.return30)),hi=Math.max(.15,...points.map(a=>a.metrics.return30));const pad=(hi-lo)*.04;lo-=pad;hi+=pad;
 const x=v=>l+(v-lo)/(hi-lo)*(r-l),y=v=>b-v*(b-t);
 let s='<svg class="chart-svg research-scatter" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Tỷ trọng taker mua 7 ngày và biến động giá 30 ngày của từng cặp Binance; chưa xác nhận ví lớn">';
 for(let i=0;i<=4;i++){const v=i/4;s+='<line class="chart-grid" x1="'+l+'" x2="'+r+'" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="'+(l-10)+'" y="'+(y(v)+4)+'" text-anchor="end">'+share(v)+'</text>';const q=lo+(hi-lo)*i/4;s+='<text x="'+x(q)+'" y="335" text-anchor="middle">'+pct(q)+'</text>';}
 s+='<line class="chart-zero" x1="'+x(0)+'" x2="'+x(0)+'" y1="'+t+'" y2="'+b+'"/><line class="chart-zero" x1="'+l+'" x2="'+r+'" y1="'+y(.5)+'" y2="'+y(.5)+'"/><text x="'+l+'" y="16">TAKER MUA 7D · %</text><text x="'+((l+r)/2)+'" y="362" text-anchor="middle">BIẾN ĐỘNG GIÁ 30D · %</text>';
 const labelled=new Set([...points].sort((a,b)=>Number(b.candidate)-Number(a.candidate)||(b.metrics.quote30||0)-(a.metrics.quote30||0)).slice(0,w<600?6:15).map(a=>a.key));
 for(const a of points){const m=a.metrics,title=a.instrument+' · Binance\nGiá30D '+pct(m.return30)+' · Taker mua7D '+share(m.buyShare7)+'\n'+a.label+'\nNgày UTC cuối '+day(m.end);s+='<g tabindex="0" role="button" data-research-key="'+esc(a.key)+'" aria-label="'+esc(title)+'"><title>'+esc(title)+'</title><circle class="'+(a.candidate===true?'research-dot-pass':a.candidate===null?'research-dot-unknown':'research-dot')+'" cx="'+x(m.return30)+'" cy="'+y(m.buyShare7)+'" r="'+(a.candidate===true?5.5:3.3)+'"/>'+(labelled.has(a.key)?'<text x="'+x(m.return30)+'" y="'+Math.max(40,y(m.buyShare7)-9)+'" text-anchor="middle">'+esc(a.base)+'</text>':'')+'</g>';}
 return s+'</svg>';
}
function table(rows){return '<div class="table-scroll"><table class="research-table"><thead><tr><th>Cặp / kiểm tra</th><th>Taker mua 7D</th><th>Taker mua 30D</th><th>Mua − bán 7D</th><th>Giá 30D</th><th>Volume 7D / nền 30D*</th></tr></thead><tbody>'+rows.map(a=>{const m=a.metrics;return '<tr><td><button class="asset" data-research-key="'+esc(a.key)+'">'+esc(a.base)+' / USDT ↗</button><div class="row-note '+(a.candidate===true?'positive':'')+'">'+(a.candidate===true?'Đạt bộ lọc · chưa xác nhận ví':a.candidate===null?'Thiếu / cũ · xem chi tiết':'Chưa đạt bộ lọc')+'</div></td><td>'+share(m.buyShare7)+'</td><td>'+share(m.buyShare30)+'</td><td class="'+(m.delta7<0?'negative':'positive')+'">'+money(m.delta7)+'</td><td>'+pct(m.return30)+'</td><td>'+(n(m.volumeRatio7vsPrior30)?fmt(m.volumeRatio7vsPrior30)+'×':'Thiếu')+'</td></tr>';}).join('')+'</tbody></table></div>';}
function pressureChart(series){
 const w=1000,h=340,l=70,r=965,t=30,b=205,bt=235,bb=295,x=i=>l+i/Math.max(1,series.length-1)*(r-l),y=v=>b-v*(b-t),max=Math.max(2,...series.filter(z=>n(z.volumeRatio7vsPrior30)).map(z=>z.volumeRatio7vsPrior30));
 let s='<svg class="chart-svg" viewBox="0 0 1000 340" role="img" aria-label="Tỷ trọng taker mua 7D/30D và volume trung bình 7D so với 30D trước đó; các cửa sổ không chồng lấn">';
 for(const v of[0,.5,1])s+='<line class="'+(v===.5?'chart-zero':'chart-grid')+'" x1="'+l+'" x2="'+r+'" y1="'+y(v)+'" y2="'+y(v)+'"/><text x="58" y="'+(y(v)+4)+'" text-anchor="end">'+share(v)+'</text>';
 for(const [field,css]of[['buyShare7','chart-ema50'],['buyShare30','chart-ema200']]){let path='',open=false;for(let i=0;i<series.length;i++){const p=series[i];if(n(p[field])){path+=(open?'L':'M')+x(i)+','+y(p[field]);open=true;}else open=false;}s+='<path class="'+css+'" d="'+path+'"/>';}
 s+='<text class="chart-ema50-label" x="70" y="17">Taker mua 7D</text><text class="chart-ema200-label" x="200" y="17">Taker mua 30D</text><text x="70" y="227">VOLUME 7D / 30D TRƯỚC ĐÓ</text>';
 for(let i=0;i<series.length;i++){const p=series[i],v=p.volumeRatio7vsPrior30;if(n(v))s+='<rect class="research-volume" x="'+x(i)+'" y="'+(bb-v/max*(bb-bt))+'" width="'+Math.max(.4,(r-l)/series.length*.8)+'" height="'+(v/max*(bb-bt))+'"><title>'+day(p.time)+' · '+fmt(v,4)+'× · Taker mua7D '+share(p.buyShare7)+'</title></rect>';}
 s+='<text x="58" y="'+bt+'" text-anchor="end">'+fmt(max,1)+'×</text><line class="chart-zero" x1="'+l+'" x2="'+r+'" y1="'+(bb-(bb-bt)/max)+'" y2="'+(bb-(bb-bt)/max)+'"/><text x="70" y="328">'+day(series[0].time)+'</text><text x="965" y="328" text-anchor="end">'+day(series.at(-1).time)+'</text></svg>';return s;
}
function init(){
 const $=id=>document.getElementById(id),S=globalThis.FlowSignals,C=globalThis.FlowCharts,V=globalThis.FlowChartsView;if(!$('research-body')||!S||!C||!V)return;
 const state={data:null,manifest:null,analyses:[],errors:[],page:0,busy:false,key:null,mode:'price',window:180,interval:'1d',criteria:{...S.DEFAULT_CRITERIA}};
 function render(){if(!state.data)return;const excludeKnown=$('research-assets').value==='excludeKnown',selected=selectRows(state.analyses,{query:$('research-search').value,scope:$('research-scope').value,sort:$('research-sort').value,page:state.page,excludeKnown});state.page=selected.page;
  const usable=state.analyses.filter(a=>a.candidate!==null&&(!excludeKnown||!a.instrumentClass?.excludedByDefault)),c=state.data.sourceCoverage,matched=usable.filter(a=>a.candidate),latest=state.data.endTime,removed=state.analyses.filter(a=>a.instrumentClass?.excludedByDefault);
  $('research-eligible').textContent=fmt(c.eligible,0);$('research-valid').textContent=fmt(usable.length,0);$('research-matched').textContent=fmt(matched.length,0);$('research-end').textContent=day(latest)+' UTC';
  const allUsable=state.analyses.filter(a=>a.candidate!==null).length;
  $('research-status').textContent='Đã kiểm tra SHA-256 và cấu trúc dữ liệu · '+c.completed+'/'+c.eligible+' cặp có nến; '+allUsable+' cặp đủ ít nhất 37 ngày liên tục và đủ đầu vào, '+(c.eligible-allUsable)+' cặp thiếu/cũ. Sau lọc loại tài sản còn '+usable.length+' cặp đủ đầu vào. Nến cuối '+day(latest)+' UTC; thu thập '+date(state.data.finishedAt||state.data.generatedAt)+'.'+(latest!==Math.floor(Date.now()/DAY)*DAY-1?' BẢN LƯU ĐÃ THIẾU NGÀY UTC MỚI NHẤT.':'');
  $('research-body').innerHTML=selected.shown.length?table(selected.shown):'<div class="chart-empty"><strong>Chưa có cặp đạt các điều kiện đang chọn</strong><p>Đổi sang “Tất cả đủ dữ liệu” để xem số đo hoặc điều chỉnh điều kiện. Đây không phải kết luận không có cá mập gom.</p></div>';
  $('research-page').textContent=fmt(selected.count,0)+' cặp khớp · Trang '+(selected.page+1)+'/'+selected.pages;$('research-prev').disabled=selected.page===0;$('research-next').disabled=selected.page+1>=selected.pages;
  $('research-asset-note').textContent=(excludeKnown?'Đang ẩn ':'Có thể ẩn ')+removed.length+' cặp thuộc danh sách bStocks/stablecoin/EUR đã đối chiếu nguồn. Đây chưa phải phân loại đầy đủ mọi sản phẩm còn lại; không loại mã bằng hậu tố. Danh mục gốc và toàn bộ nến vẫn được giữ.';
  const query=$('research-search').value.trim().toUpperCase(),mapRows=state.analyses.filter(a=>(!excludeKnown||!a.instrumentClass?.excludedByDefault)&&(!query||a.base.toUpperCase().includes(query)||a.instrument.toUpperCase().includes(query)));
  $('research-map').innerHTML=scatter(mapRows,{width:$('research-map').clientWidth||1100});$('research-map-meta').textContent='Mỗi điểm là một cặp Binance trong bộ lọc tìm kiếm, gồm cả cặp chưa đạt điều kiện; chỉ vẽ khi có số đo giá 30D và tỷ trọng mua 7D. Xanh sáng: đạt toàn bộ điều kiện đang chọn. Vị trí không phải ASI hoặc xác suất tăng giá.';
  $('research-exclusions').textContent=[...state.analyses.filter(a=>a.candidate===null).map(a=>a.instrument+': '+a.reasons.map(z=>z.message).join('; ')),...state.errors.map(x=>x.key+': '+x.message),...(state.data.errors||[]).map(x=>(x.instrument||x.key||'Nguồn')+': '+(x.message||JSON.stringify(x)))].join('\n')||'Không có cặp bị loại.';
 }
 function reanalyze(resetPage=true){if(!state.data)return;const out=analyzeAll(state.data,S,{criteria:state.criteria});state.analyses=out.analyses.map(a=>({...a,instrumentClass:globalThis.FlowInstrumentClasses?.classify(a.sourceId,a.instrument)}));state.errors=out.errors;if(resetPage)state.page=0;render();if(state.key)renderDetail();}
 function renderDetail(){if(!state.data.histories[state.key])return;const h=state.data.histories[state.key],a=S.analyze(h,{criteria:state.criteria,windowDays:365}),m=a.metrics;const aggregate=C.aggregateBarsUTC(h.bars,{asOf:h.asOf,now:Date.now(),interval:state.interval,windowDays:state.window});const ma=new Map(a.seriesFull.map(b=>[b.end,b]));const series=aggregate.series.map(b=>({...b,sma20:ma.get(b.end)?.sma20??null,ema50:ma.get(b.end)?.ema50??null,ema200:ma.get(b.end)?.ema200??null}));const daily=a.seriesFull.filter(b=>b.time>=m.end+1-state.window*DAY);
  $('research-detail-title').textContent=a.base+' / USDT · Binance';
  const stats='<div class="onchain-stats"><div><span>GIÁ ĐÓNG CỬA</span><strong>'+fmt(m.close,8)+' USDT</strong><p>'+day(m.end)+' UTC · '+h.bars.length+' nến</p></div><div><span>TAKER MUA / TỔNG GD 7D</span><strong>'+share(m.buyShare7)+'</strong><p>30D: '+share(m.buyShare30)+'</p></div><div><span>MUA − BÁN CHỦ ĐỘNG 7D</span><strong class="'+(m.delta7<0?'negative':'positive')+'">'+money(m.delta7)+'</strong><p>30D: '+money(m.delta30)+'</p></div></div>';
  const controls='<div class="detail-controls"><div class="segmented">'+[['price','Nến & EMA'],['delta','Mua − bán'],['cvd','CVD'],['pressure','Tỷ trọng mua']].map(([id,label])=>'<button data-research-mode="'+id+'" class="'+(state.mode===id?'selected':'')+'">'+label+'</button>').join('')+'</div><label>Lịch sử <select data-research-window>'+[30,90,180,365].map(v=>'<option value="'+v+'" '+(v===state.window?'selected':'')+'>'+v+' ngày</option>').join('')+'</select></label><label>Khung nến <select data-research-interval '+(state.mode==='pressure'?'disabled':'')+'>'+[['1d','Ngày'],['1w','Tuần'],['1M','Tháng']].map(([v,label])=>'<option value="'+v+'" '+(v===state.interval?'selected':'')+'>'+label+'</option>').join('')+'</select></label></div>';
  const criteria='<div class="research-checks">'+a.criteria.map(c=>'<article><span class="pill '+(c.pass===null?'warning':c.pass?'positive':'')+'">'+(c.pass===null?'Thiếu':c.pass?'Đạt':'Chưa đạt')+'</span><p>'+esc(c.label)+'</p><strong>'+(c.unit==='fraction'?(c.id.startsWith('return')?pct(c.value):share(c.value)):fmt(c.value)+'×')+'</strong><small>'+esc(c.operator)+' '+(c.unit==='fraction'?pct(c.threshold):fmt(c.threshold)+'×')+'</small></article>').join('')+'</div>';
  let chart=state.mode==='pressure'?pressureChart(daily):V.daily(series,{mode:state.mode,interval:state.interval,width:Math.max(360,$('research-detail-body').clientWidth||1150)});
  const proof=h.provenance.map(p=>'<p class="small proof-line"><a href="'+esc(p.url)+'" target="_blank" rel="noopener noreferrer">Nến gốc Binance ↗</a><br>SHA-256 <code>'+p.sha256+'</code></p>').join('');
  $('research-detail-body').innerHTML='<p class="pill '+(a.candidate?'positive':'warning')+'">'+esc(a.label)+'</p>'+stats+controls+'<div class="detail-chart">'+chart+'</div><p class="chart-note">'+(state.mode==='pressure'?'Hai đường: tỷ trọng mua 7D/30D, đường tham chiếu 50%; cột: volume/ngày 7D chia volume/ngày của 30 ngày ngay trước đó.':state.mode==='cvd'?'CVD đặt lại về 0 ở đầu cửa sổ đang xem; khi thiếu taker thì không điền 0.':state.mode==='delta'?'Cột là mua chủ động − bán chủ động (USDT); giá đóng cửa dùng trục riêng bên phải.':'SMA20, EMA50 và EMA200 tính trên toàn bộ lịch sử ngày trước khi cắt cửa sổ; EMA khởi tạo bằng SMA. Thiếu 200 ngày liên tục thì EMA200 để trống.')+' Đã có '+daily.length+'/'+state.window+' ngày trong cửa sổ; '+aggregate.excluded.length+' kỳ biên/thiếu ngày bị loại khi gộp UTC.</p><h3>Điều kiện bạn đang dùng</h3>'+criteria+'<p class="small">Các ngưỡng là bộ lọc mô tả có thể chỉnh, chưa được kiểm chứng khả năng dự báo. Điểm đánh dấu trong quá khứ chỉ dùng thông tin tới nến ngày đó; đây chưa phải kết quả backtest và danh mục hiện tại có thiên lệch sống sót.</p><p class="note">Chưa có giá vốn theo tuổi holder, Realized/Balance/Delta/Undervalue/Diamond hoặc các nhãn Shark/Whale Action như ảnh A1. EMA200 và dòng khớp lệnh không cung cấp các số liệu đó. Chưa xác nhận danh tính người mua hay số token họ còn giữ.</p><details><summary>Nguồn và phép tính</summary><p class="small">Thời gian nguồn '+date(h.asOf)+' · nhận '+date(h.fetchedAt)+'. Tỷ trọng mua = tổng quote mua chủ động / tổng quote giao dịch cùng cửa sổ. Delta = 2 × mua chủ động − tổng giao dịch. Volume 7D so với 30D liền trước, hai cửa sổ không chồng lấn.</p>'+proof+'</details>';
 }
 function open(key){if(!state.analyses.some(a=>a.key===key))return;state.key=key;state.mode='price';state.window=180;state.interval='1d';renderDetail();$('research-detail').showModal();}
 for(const id of['research-search','research-scope','research-sort','research-assets'])$(id).addEventListener(id==='research-search'?'input':'change',()=>{state.page=0;render();});
 $('research-prev').addEventListener('click',()=>{state.page--;render();});$('research-next').addEventListener('click',()=>{state.page++;render();});
 for(const id of['research-body','research-map']){$(id).addEventListener('click',e=>{const b=e.target.closest('[data-research-key]');if(b)open(b.dataset.researchKey);});$(id).addEventListener('keydown',e=>{const b=e.target.closest('[data-research-key]');if(b&&['Enter',' '].includes(e.key)){e.preventDefault();open(b.dataset.researchKey);}});}
 $('research-detail-close').addEventListener('click',()=>{$('research-detail').close();state.key=null;});$('research-detail').addEventListener('cancel',()=>{state.key=null;});
 $('research-detail-body').addEventListener('click',e=>{const b=e.target.closest('[data-research-mode]');if(b){state.mode=b.dataset.researchMode;renderDetail();}});
 $('research-detail-body').addEventListener('change',e=>{if(e.target.matches('[data-research-window]'))state.window=Number(e.target.value);else if(e.target.matches('[data-research-interval]'))state.interval=e.target.value;else return;renderDetail();});
 $('research-apply').addEventListener('click',()=>{try{const c={buyShare7Min:Number($('criteria-buy7').value)/100,buyShare30Min:Number($('criteria-buy30').value)/100,return30Min:Number($('criteria-price-min').value)/100,return30Max:Number($('criteria-price-max').value)/100,volumeRatioMin:Number($('criteria-volume').value)};if(Object.values(c).some(v=>!n(v))||c.buyShare7Min<0||c.buyShare7Min>1||c.buyShare30Min<0||c.buyShare30Min>1||c.return30Min< -1||c.return30Max<c.return30Min||c.volumeRatioMin<0)throw Error('Ngưỡng lọc ngoài phạm vi hợp lệ.');state.criteria=c;reanalyze();$('research-filter-status').textContent='Đã áp dụng điều kiện mô tả của bạn; chưa xác nhận ví.';}catch(e){$('research-filter-status').textContent=e.message;}});
 $('research-reload').addEventListener('click',load);
 async function load(){if(state.busy)return;state.busy=true;$('research-reload').disabled=true;$('research-status').textContent='Đang đọc bản nghiên cứu và kiểm tra mã băm nến gốc…';try{const r=await loadDataset();state.data=r.data;state.manifest=r.manifest;reanalyze();}catch(e){$('research-status').textContent='Chưa đọc được bản mới: '+e.message+(state.data?' Giữ bản đang xem với thời điểm cũ.':' Không tạo điểm hoặc tín hiệu thay thế.');}finally{state.busy=false;$('research-reload').disabled=false;}}
 load();let lastDay=Math.floor(Date.now()/DAY);setInterval(()=>{const d=Math.floor(Date.now()/DAY);if(state.data&&d!==lastDay){lastDay=d;reanalyze(false);}},60000);
 if(!location.hash||location.hash==='#research')document.querySelector('[data-panel="research"]')?.click();
}
return {checkManifest,validateDataset,loadDataset,analyzeAll,selectRows,scatter,table,pressureChart,init};
});
