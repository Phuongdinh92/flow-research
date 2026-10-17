'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const zlib=require('node:zlib');
const T=require('./terminal-ui.js');
const H=require('./holder-history.js');
const L=require('./chain-ledger.js');
const S=require('./signal-core.js');
const I=require('./intelligence-core.js');
const json=f=>JSON.parse(fs.readFileSync('data/'+f,'utf8'));
const history=json('holder-history-snapshot.json');
const ledger=json('chain-ledger-snapshot.json');
const study=json('intelligence-study.json');
test('token search retains native venue identity and puts exact matches before prefix matches',()=>{
 const rows=[{key:'binance:WBTCUSDT',base:'WBTC',instrument:'WBTCUSDT',quote30:900},{key:'binance:BTCUSDT',base:'BTC',instrument:'BTCUSDT',quote30:10},{key:'other:BTC',base:'BTC',instrument:'BTC',quote30:1}];
 assert.deepEqual(T.rankTokens(rows,' btc ').map(r=>r.key),['binance:BTCUSDT','other:BTC','binance:WBTCUSDT']);
 assert.equal(T.rankTokens(rows,'not-present').length,0);assert.equal(rows[0].key,'binance:WBTCUSDT');
});
test('market breadth uses valid denominators and volume-weighted taker share, excluding only explicit classes',()=>{
 const row=(key,m,excluded=false)=>({key,metrics:m,instrumentClass:{excludedByDefault:excluded}});
 const out=T.deriveContext([row('binance:BTCUSDT',{return7:.1,return30:null,quote7:100,buyQuote7:90,buyShare7:.9}),row('b',{return7:-.1,return30:.3,quote7:900,buyQuote7:360,buyShare7:.4}),row('c',{return7:null,return30:null,buyShare7:null}),row('d',{return7:1,return30:1,quote7:1e9,buyQuote7:1e9,buyShare7:1},true)]);
 assert.equal(out.total,3);assert.equal(out.breadth7,.5);assert.equal(out.breadth30,1);assert.equal(out.weightedBuyShare7,.45);assert.equal(out.btc.return7,.1);
 assert.equal(T.deriveContext([]).breadth7,null);assert.equal(T.deriveContext([]).weightedBuyShare7,null);
});
test('line chart preserves null gaps instead of connecting through missing balances',()=>{
 const html=T.lineChart([{time:1,x:2},{time:2,x:null},{time:3,x:5}],[{key:'x',label:'Số dư'}],{unit:'HBAR'});
 const path=html.match(/class="terminal-track track-0" d="([^"]*)"/)[1];assert.equal((path.match(/M/g)||[]).length,2);assert.equal((html.match(/data-terminal-index/g)||[]).length,2);assert.doesNotMatch(html,/NaN|Infinity/);
 assert.match(T.lineChart([{time:1,x:null}],[{key:'x',label:'X'}]),/Chưa có chuỗi/);
});
test('chart observations expose keyboard and pointer readouts with actual units',()=>{
 const html=T.lineChart([{time:Date.UTC(2026,9,1),x:.25}],[{key:'x',label:'Funding'}],{unit:'% / giờ'});
 assert.match(html,/tabindex="0"/);assert.match(html,/data-terminal-tip=/);assert.match(html,/% \/ giờ/);
 const bars=T.barChart([{label:'Mất dữ liệu',value:null},{label:'Giảm',value:-12,exact:'−12.00000001'}],{unit:'HBAR',horizontal:true});
 assert.match(bars,/Thiếu/);assert.match(bars,/−12\.00000001 HBAR/);assert.doesNotMatch(bars,/NaN|Infinity/);
});
test('funding display preserves actual nonzero hourly rates, including sub-rounding positive and negative values',()=>{
 const snapshot=json('derivatives-snapshot.json'),btc=snapshot.assets.find(a=>a.nativeName==='BTC');assert.ok(btc&&btc.fundingRateHourly!==0);
 const rates=[btc.fundingRateHourly,1.25e-5,-1.25e-5,1e-12,-1e-12,Number.MIN_VALUE,-Number.MIN_VALUE];
 for(const rate of rates){const text=T.fundingPercent(rate);assert.notEqual(text,'+0%');assert.notEqual(text,'0%');assert.notEqual(text,'-0%');assert.ok(Number(text.replace('%','').replace(',','.'))!==0,text);assert.equal(text.startsWith('-'),rate<0);}
 assert.equal(T.fundingPercent(0),'0%');assert.equal(T.fundingPercent(null),'—');
 const metric=T.fundingMetric(btc);assert.match(metric,/Raw native funding fraction/);assert.ok(metric.includes(btc.rawContext.funding));assert.ok(metric.includes(T.fundingPercent(btc.fundingRateHourly)));
 const chart=T.lineChart([{time:1,funding:1e-12,rawRate:'0.000000000001'}],[{key:'funding',label:'Funding',format:(v,row)=>T.fundingPercent(v)+' · native fraction: '+row.rawRate,appendUnit:false}],{axisFormat:T.fundingPercent,unit:'Funding · % / kỳ',zero:true});
 assert.match(chart,/native fraction: 0\.000000000001/);assert.match(chart,/e-10%/);assert.doesNotMatch(chart,/>\+0%<|Funding: \+0%/);
});
test('HBAR default chart anchor spans 30 days while an explicit chosen anchor is preserved',()=>{
 assert.equal(T.holderChartData(history,H).anchor.id,'30d');assert.equal(T.holderChartData(history,H,'7d').anchor.id,'7d');
});
test('holder observations alone do not certify a purchase, retention or owner',()=>{
 const html=T.evidenceLadder({history:{},holder:true});
 assert.match(html,/Số dư địa chỉ/);assert.match(html,/Đã quan sát · chưa xác nhận mua/);assert.doesNotMatch(html,/>Nhận token</);
 assert.equal((html.match(/class="observed"/g)||[]).length,2);assert.equal((html.match(/class="pending"/g)||[]).length,2);
});
test('actual HBAR chart keeps fixed-account balances null when cohort members are missing',()=>{
 const out=T.holderChartData(history,H,'90d');const raw=H.cohortSeries(history,{anchorObservationId:out.anchor.id});
 for(const [i,g] of raw.groups.entries())for(const p of g.points){const row=out.rows.find(r=>r.time===p.timeMs);if(!row)continue;assert.equal(row['g'+i],p.balanceRaw===null?null:Number(p.balanceRaw)/1e8);}
 assert.equal(out.anchor.id,'90d');assert.ok(out.rows.length>=2);
});
test('actual acquisition ledger renders receipt routes and zero-to-upper retention bounds without declaring retained buys',()=>{
 const html=T.ledgerHtml(ledger,L,{tokenAddress:ledger.tokens[0].address,cexKey:'binance:UNIUSDT'});
 assert.match(html,/Phạm vi độc lập với binance:UNIUSDT/);assert.match(html,/chưa tự nối token cùng ticker/);
 assert.match(html,/GIÁ THỰC HIỆN SWAP/);assert.match(html,/chưa là giá vốn tồn kho/);assert.match(html,/giới hạn có thể, chưa phải lượng đã xác nhận giữ/);
 assert.match(html,/Contract/);assert.doesNotMatch(html,/NaN|Infinity/);assert.match(html,/data-terminal-acquisition=/);
});
test('checkpoint selection chooses nearest requested day consistently regardless of source order',()=>{
 const fixture=[{daysBeforeFinalized:6.02,deltaRaw:'-241'},{daysBeforeFinalized:7.99,deltaRaw:'-301'},{daysBeforeFinalized:7.02,deltaRaw:'-105'}],before=structuredClone(fixture);
 assert.equal(T.nearestCheckpoint(fixture,7),fixture[2]);assert.equal(T.nearestCheckpoint([...fixture].reverse(),7),fixture[2]);assert.deepEqual(fixture,before);
 assert.equal(T.nearestCheckpoint(fixture,1),null);assert.equal(T.nearestCheckpoint([{daysBeforeFinalized:7.3}],7),null);assert.equal(T.nearestCheckpoint([{daysBeforeFinalized:null}],7),null);
});
test('actual AAVE recipient chart and table use the same nearest seven-day block and exact delta',()=>{
 const token=ledger.tokens.find(t=>t.symbol==='AAVE'),activity=L.addressActivity(ledger,token.address),position=activity.find(a=>a.address==='0x51c72848c68a965f66fa7a88855f9f7784502a7f');assert.ok(position);
 const checkpoint=T.nearestCheckpoint(position.balanceChanges,7),independent=position.balanceChanges.reduce((best,p)=>Math.abs(p.daysBeforeFinalized-7)<Math.abs(best.daysBeforeFinalized-7)?p:best);assert.equal(checkpoint,independent);
 const exact=L.formatUnits(checkpoint.deltaRaw,token.decimals,10),html=T.ledgerHtml(ledger,L,{tokenAddress:token.address}),inventory=html.slice(html.indexOf('RECIPIENT INVENTORY'),html.indexOf('<table class="terminal-ledger-table"'));
 const addressLabel=position.address.slice(0,10)+'…'+position.address.slice(-8),tips=[...inventory.matchAll(/data-terminal-tip="([^"]+)"/g)].map(m=>m[1]),tip=tips.find(t=>t.startsWith(addressLabel+':'));
 assert.ok(tip.includes(exact+' AAVE'),tip);assert.ok(tip.includes(checkpoint.timestamp.slice(0,19).replace('T',' ')),tip);assert.ok(tip.includes('block '+checkpoint.blockNumber),tip);
 assert.ok(inventory.includes('>'+exact+'<small class="terminal-checkpoint-time">'),exact);assert.match(inventory,/Biểu đồ và bảng dùng chung mốc/);
});
test('ambiguous acquisition exposes no fabricated final recipient or acquired amount',()=>{
 const ambiguous=ledger.acquisitions.find(a=>!a.finalRecipient);assert.ok(ambiguous);
 const html=T.ledgerHtml(ledger,L,{tokenAddress:ambiguous.tokenAddress,acquisitionId:ambiguous.swapId});
 assert.match(html,/Tuyến chuyển chưa rõ/);assert.match(html,/Chưa đối chiếu được tồn kho/);assert.doesNotMatch(html,/null [A-Z]{2,10}/);
});
test('verified liquidity pool is explicitly excluded from buyer retention analysis',()=>{
 const pool=ledger.acquisitions.find(a=>a.excludeFromAccumulation);assert.ok(pool);
 const html=T.ledgerHtml(ledger,L,{tokenAddress:pool.tokenAddress,acquisitionId:pool.swapId});
 assert.match(html,/Pool thanh khoản · loại khỏi đánh giá gom/);assert.match(html,/Không áp dụng giữ lô mua cho pool thanh khoản/);
 assert.doesNotMatch(html,/Lượng của lô mua có thể còn giữ:/);assert.match(html,/recipientRoles/);
});
test('wallet relationship view counts observed address reuse without common-owner attribution',()=>{
 const token=ledger.tokens[0],html=T.clusterHtml(ledger,{tokenAddress:token.address});
 assert.match(html,/Liên kết trực tiếp trong receipt/);assert.match(html,/chưa phải cụm ví cùng chủ/);assert.match(html,/Router, contract hoặc cùng nơi nhận không xác nhận/);
});
test('event study shows adverse medians and sample limits, rather than recasting positive rate as prediction accuracy',()=>{
 const html=T.studyHtml(study,'binance:HBARUSDT');
 assert.match(html,/Chưa chứng minh được lợi thế dự báo/);assert.match(html,/âm ở cả hai cửa sổ/);assert.match(html,/chưa phải xác suất dự báo/);assert.match(html,/thiên lệch sống sót/);assert.match(html,/7 ngày/);assert.match(html,/180 ngày/);
 assert.match(html,/Trung vị sau chi phí giả định/);assert.doesNotMatch(html,/độ chính xác dự báo/);
});
test('study verdict recomputes after changed outcomes instead of retaining old adverse copy',()=>{
 const changed=structuredClone(study);changed.eventStudy.summary['7'].netReturn.median=.1;changed.eventStudy.summary['30'].netReturn.median=.2;
 const html=T.studyHtml(changed,'binance:HBARUSDT');assert.doesNotMatch(html,/âm ở cả hai cửa sổ/);assert.match(html,/chưa được kiểm định độc lập/);
});
test('real token analysis keeps transparent raw component units and never emits normalized ASI scores',()=>{
 const data=JSON.parse(zlib.gunzipSync(fs.readFileSync('data/research-snapshot.json.gz'))),h=data.histories['binance:HBARUSDT'];
 const a=S.analyze(h,{windowDays:365}),intel=I.analyze(h),html=T.diagnosis(a,intel);
 assert.match(html,/Năm góc nhìn dùng số đo gốc/);assert.match(html,/Chưa xác nhận chủ thể tích lũy/);assert.match(html,/So EMA200/);assert.match(html,/RSI14 Wilder/);assert.doesNotMatch(html,/ASI: [0-9]/);
});
test('untrusted token text and source URLs cannot inject markup or active links',()=>{
 assert.equal(T.esc('<script>x</script>'),'&lt;script&gt;x&lt;/script&gt;');
 const html=T.proofHtml({key:'<img>',base:'X',quote:'USDT',sourceId:'binance',bars:[],asOf:1,fetchedAt:2,provenance:[{url:'javascript:alert(1)',sha256:'<b>'}]});
 assert.doesNotMatch(html,/href="javascript:/);assert.doesNotMatch(html,/<img>/);assert.match(html,/&lt;b&gt;/);
});
