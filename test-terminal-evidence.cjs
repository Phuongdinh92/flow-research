'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const T=require('./terminal-ui.js'),R=require('./inventory-ledger.js'),L=require('./chain-ledger.js');
test('selected live quote never promotes a prior connection or old symbol event to current',()=>{
 const now=1792240000000,row={last:.08,return24:.01,eventTime:now-1000,receivedAt:now-900,stale:false};
 assert.match(T.liveQuoteHtml(row,{state:'live',connectedAt:now-2000},now),/đang nhận/);
 assert.match(T.liveQuoteHtml(row,{state:'live',connectedAt:now-500},now),/trễ/);
 assert.match(T.liveQuoteHtml(row,{state:'paused',connectedAt:now-2000},now),/tạm dừng/);
 assert.match(T.liveQuoteHtml(row,{state:'live',connectedAt:now-2000},now+6000),/trễ/);
 assert.match(T.liveQuoteHtml(row,{state:'live',connectedAt:now-2000},now),/chưa xác định thời điểm khớp lệnh cuối/);assert.match(T.liveQuoteHtml({...row,last:1e-12},{state:'live',connectedAt:now-2000},now),/1\.000000e-12 USDT/);
});
test('inventory display keeps exact residual proof and measured dates rather than inferred sales or ownership',()=>{
 const report=JSON.parse(fs.readFileSync('data/inventory-ledger.json')),token=report.positions.find(p=>p.symbol==='AAVE').tokenAddress;
 const html=T.inventoryHtml(report,R,L,token),position=report.positions.find(p=>p.symbol==='AAVE'&&!p.excludedFromAccumulation);
 assert.ok(html.includes('raw='+position.recent7d.unexplainedNetRaw));assert.match(html,/Ròng chưa giải thích/);assert.match(html,/không xác định mua, bán/);assert.match(html,/2026-10-16/);assert.match(html,/Lịch sử chuyển chưa đầy đủ/);
});
test('price-zone observations retain partial-window meaning and exact tiny quote amounts',()=>{
 const d={instrument:'BTCUSDT',count:2,buyQuote:'0.000000000000000001',sellQuote:'0',deltaQuote:'0.000000000000000001',bins:[{priceFrom:'1',priceTo:'2',deltaQuote:'0.000000000000000001',count:2}],firstTradeAt:1792240000000,latestTradeAt:1792240001000,gaps:[],windowMs:1800000,maxTrades:10000};
 const h=T.orderFlowHtml(d,{status:'live'});assert.ok(h.includes(d.buyQuote+' USDT'));assert.match(h,/Chỉ quan sát từ khi mở trang/);assert.match(h,/Không phải thống kê toàn ngày/);assert.match(h,/30 phút/);assert.match(h,/10000 bản ghi aggTrade/);
 assert.match(T.orderFlowHtml(null,{status:'blocked',reason:'source_error'}),/đã dừng: source_error/);
});

test('every observed price region remains reachable through bounded pages',()=>{
 const bins=Array.from({length:81},(_,i)=>({priceFrom:String(i),priceTo:String(i+1),deltaQuote:'1',count:1})),d={instrument:'BTCUSDT',count:81,buyQuote:'81',sellQuote:'0',deltaQuote:'81',bins,firstTradeAt:1792240000000,latestTradeAt:1792240001000,gaps:[],windowMs:1800000,maxTrades:10000};
 const html=T.orderFlowHtml(d,{status:'live'},{page:3});assert.match(html,/trang 3\/3/);assert.match(html,/80–81/);assert.match(html,/bản ghi khớp gộp/);assert.doesNotMatch(html,/0–1:/);
});
