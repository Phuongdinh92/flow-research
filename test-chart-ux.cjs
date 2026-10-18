'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const V=require('./charts-view.js');
const DAY=86400000,first=Date.UTC(2026,9,15);

function frozen(value){if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function barsAt(close=80512.34){return frozen(Array.from({length:3},(_,i)=>({time:first+i*DAY,end:first+(i+1)*DAY-1,open:close*.9998,high:close*1.0004,low:close*.9996,close,quote:i===2?1160000000:1100000000,buy:580000000,sma20:close*.999999,ema50:close===80512.34?80498.127869324:close*.999998,ema200:close*.999997})));}
function visible(html){return html.replace(/<title\b[^>]*>[\s\S]*?<\/title>/g,'').replace(/<desc\b[^>]*>[\s\S]*?<\/desc>/g,'').replace(/<[^>]*>/g,' ');}
function attributes(tag){return Object.fromEntries([...tag.matchAll(/\b([\w:-]+)="([^"]*)"/g)].map(match=>[match[1],match[2]]));}
function boxes(svg){return [...svg.matchAll(/<g\b([^>]*\bclass="chart-end-label(?: [^"]*)?"[^>]*)>([\s\S]*?)<\/g>/g)].map(match=>{const group=attributes(match[1]),rect=attributes(match[2].match(/<rect\b[^>]*>/)?.[0]||'');return {id:group['data-price-level'],actualY:Number(group['data-actual-y']),labelY:Number(group['data-label-y']),x:Number(rect.x),y:Number(rect.y),width:Number(rect.width),height:Number(rect.height),body:match[2]};});}
function assertRail(svg,expectedCount){
 const root=attributes(svg.match(/<svg\b[^>]*>/)[0]),[,,width,height]=root.viewBox.split(' ').map(Number),right=Number(root['data-plot-right']),found=boxes(svg);
 assert.equal(found.length,expectedCount);assert.equal(new Set(found.map(box=>box.id)).size,expectedCount);
 for(const box of found){for(const field of ['actualY','labelY','x','y','width','height'])assert(Number.isFinite(box[field]),`${box.id} ${field}`);assert(box.x>=right,`${box.id} intrudes into candles`);assert(box.x+box.width<=width+.0001,`${box.id} clipped horizontally`);assert(box.y>=0&&box.y+box.height<=height+.0001,`${box.id} clipped vertically`);assert(box.width>0&&box.height>0);}
 found.sort((a,b)=>a.y-b.y);for(let i=1;i<found.length;i++)assert(found[i-1].y+found[i-1].height<=found[i].y+.0001,`${found[i-1].id} overlaps ${found[i].id}`);
 return found;
}

test('BTC price formatting preserves whole price and cents; tiny values remain nonzero',()=>{
 assert.equal(V.priceValue(80512.34),'80,512.34');
 assert.equal(V.priceValue(80498.127869324),'80,498.13');
 assert.equal(V.priceValue(0),'0.00');
 for(const value of [4.5678e-9,9.9e-20]){const formatted=V.priceValue(value);assert(/e-/.test(formatted));assert(Number(formatted)>0);assert(!/(?:NaN|Infinity|undefined)/.test(formatted));}
 assert.equal(V.priceValue(null),'—');assert.equal(V.priceValue(NaN),'—');
});

test('compact OHLC readout uses readable price/EMA values and compact quote volume',()=>{
 const bar=barsAt().at(-1),tracks=frozen([{id:'ema50',label:'EMA50',value:bar.ema50},{id:'missing',label:'Unavailable',value:null}]);
 const html=V.compactPriceReadout(bar,tracks),text=visible(html);
 assert(text.includes('80,512.34'));assert(text.includes('80,498.13'));assert(text.includes('1.16B'));assert(text.includes('USDT'));assert(text.includes('Đã đóng'));
 assert(!text.includes('80498.127869324'));assert(!text.includes('1160000000'));assert(!text.includes('Unavailable'));
 for(const label of ['O','H','L','C','Vol'])assert(html.includes('<dt>'+label+'</dt>'));
 const forming=V.compactPriceReadout({...bar,provisional:true},tracks);assert(forming.includes('Đang hình thành'));assert(forming.includes('forming'));
});

test('untrusted readout labels and track ids cannot inject HTML or attributes',()=>{
 const label='<img src=x onerror="bad()"> & <script>bad()</script>',html=V.compactPriceReadout(barsAt().at(-1),[{id:'x" onclick="bad()',label,value:80512.34}]);
 assert(!/<(?:img|script)\b/i.test(html));assert(!html.includes('onclick="bad()'));assert(html.includes('&lt;img'));assert(html.includes('&lt;script&gt;'));assert(html.includes('&amp;'));assert(html.includes('price-readout-reference'));
});

test('price chart height is responsive without changing supplied market bars',()=>{
 const bars=barsAt(),before=JSON.stringify(bars);
 for(const [width,height] of [[320,400],[768,460],[1800,520]]){
  assert.deepEqual(V.priceDimensions(width),{width,height});const svg=V.daily(bars,{width,showLegend:false});
  assert(svg.includes(`viewBox="0 0 ${width} ${height}"`));assert.equal((svg.match(/data-price-sample=/g)||[]).length,bars.length);assert(!svg.includes('chart-legend-chip'));assertRail(svg,4);
 }
 assert.equal(JSON.stringify(bars),before);
});

test('end labels for almost identical close and moving averages never overlap or cover candles',()=>{
 const bars=barsAt();for(const width of [320,768,1800]){
  const svg=V.daily(bars,{width,showLegend:false}),rail=assertRail(svg,4),text=visible(svg);
  assert(rail.some(box=>box.id==='price'));assert(rail.some(box=>box.id==='ema50'));assert(text.includes('80,512.34'));assert(text.includes('80,498.13'));
  assert(!rail.some(box=>/\b80\.5K\b/.test(visible(box.body))));assert(svg.includes('EMA50 ngày: 80498.127869324 USDT'));
  assert(!/(?:NaN|Infinity|undefined)/.test(svg));
 }
});

test('price axis uses complete BTC values while the separate volume readout stays compact',()=>{
 const svg=V.daily(barsAt(),{width:768,showLegend:false}),ticks=[...svg.matchAll(/<text\b[^>]*class="[^"]*\bchart-right-axis\b[^"]*"[^>]*>(.*?)<\/text>/g)].map(match=>match[1]);
 assert(ticks.length>=2);for(const tick of ticks){assert(!/[KMBT]$/.test(tick),`price tick ${tick} has a volume suffix`);assert(/\d/.test(tick));}
 assert(visible(V.compactPriceReadout(barsAt().at(-1))).includes('1.16B'));
});

test('tiny-priced assets keep finite readable prices and disjoint outside rails at all supported widths',()=>{
 const bars=barsAt(4.5678e-9),before=JSON.stringify(bars);for(const width of [320,768,1800]){
  const svg=V.daily(bars,{width,showLegend:false});assertRail(svg,4);assert(visible(svg).includes('4.56780e-9'));assert(!/(?:NaN|Infinity|undefined)/.test(svg));
 }
 assert.equal(JSON.stringify(bars),before);
});

test('label arrangement preserves true positions and leaves input immutable while separating crowded labels',()=>{
 const input=frozen([{id:'price',actualY:110,value:80512.34},{id:'ema50',actualY:110.01,value:80512.33},{id:'ema200',actualY:109.99,value:80512.35},{id:'sma20',actualY:110.02,value:80512.32}]),before=JSON.stringify(input);
 const arranged=V.layoutPriceLabels(input,{top:20,bottom:260,gap:32});assert.equal(arranged.length,input.length);
 for(const label of arranged){assert.equal(label.actualY,input.find(original=>original.id===label.id).actualY);assert(label.labelY>=35&&label.labelY<=245);}
 for(let i=1;i<arranged.length;i++)assert(arranged[i].labelY-arranged[i-1].labelY>=32-1e-9);
 assert.equal(JSON.stringify(input),before);assert(arranged.some(label=>Math.abs(label.labelY-label.actualY)>1));
});

test('verified custom-track labels remain escaped in the exact proof and visible rail',()=>{
 const bars=barsAt(),label='<img src=x onerror="bad()"> & quote',tracks=frozen([{id:'safe-level',label,color:'#aabbcc',verified:true,points:bars.map(bar=>({time:bar.time,value:80512.35}))}]);
 const svg=V.daily(bars,{width:320,showLegend:false,priceTracks:tracks});assertRail(svg,5);assert(!/<(?:img|script)\b/i.test(svg));assert(svg.includes('&lt;img'));assert(svg.includes('&amp; quote'));assert(!svg.includes('onerror="bad()"'));
});

test('restoring a historical chart keeps the same UTC range and inspected candle after another daily bar arrives',()=>{
 const bars=Array.from({length:40},(_,i)=>({time:first+i*DAY,end:first+(i+1)*DAY-1})),view={from:bars[5].time,to:bars[12].end,count:8,full:false,pinned:false,inspecting:true,selectedTime:bars[9].time},next=bars.slice(1),restored=V.restoredViewport(next,view);
 assert.equal(next[restored.lo].time,view.from);assert.equal(next[restored.hi-1].end,view.to);assert.equal(next[restored.lo+restored.selected].time,view.selectedTime);assert.equal(restored.inspecting,true);assert.equal(restored.hi-restored.lo,8);
});

test('restoring a pinned chart follows the newest UTC bar while an expired inspection returns to the visible latest candle',()=>{
 const bars=Array.from({length:25},(_,i)=>({time:first+i*DAY,end:first+(i+1)*DAY-1})),view={from:bars[17].time,to:bars[24].end,count:8,full:false,pinned:true,inspecting:true,selectedTime:bars[2].time},restored=V.restoredViewport(bars,view);
 assert.equal(restored.hi,bars.length);assert.equal(restored.hi-restored.lo,8);assert.equal(restored.selected,7);assert.equal(restored.inspecting,false);assert.deepEqual(V.restoredViewport([],view),{lo:0,hi:0,selected:0,inspecting:false});
});
