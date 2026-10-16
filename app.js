/* Public descriptive statistics only. No private strategy, ranking thresholds or backtest engine. */
(function(root){
'use strict';
const DAY=86400000;
function number(v){if(v===null||v===undefined||typeof v==='boolean'||(typeof v==='string'&&!v.trim()))throw Error('Thiếu giá trị số');const n=Number(v);if(!Number.isFinite(n))throw Error('Giá trị số không hợp lệ');return n;}
function stamp(v){let n=number(v);if(n>=1e14)n=Math.floor(n/1000);if(!Number.isInteger(n)||n<946684800000||n>=4102444800000)throw Error('Timestamp không hợp lệ');return n;}
function symbols(value){const a=[...new Set(value.toUpperCase().split(/[\s,;]+/).filter(Boolean).map(s=>s.endsWith('USDT')?s:s+'USDT'))];if(!a.length||a.length>30||a.some(s=>!/^([A-Z0-9]{1,20})USDT$/.test(s)))throw Error('Nhập từ 1 đến 30 mã hợp lệ, ví dụ BTC, LINK, W.');return a;}
function parse(raw,asOf){asOf=stamp(asOf);if(!Array.isArray(raw))throw Error('Nguồn không trả danh sách nến');const map=new Map();let dropped=0;
for(const a of raw){if(!Array.isArray(a)||a.length<11)throw Error('Nến thiếu trường');const time=stamp(a[0]),end=stamp(a[6]);if(time%DAY||end!==time+DAY-1)throw Error('Không phải nến ngày UTC');if(end>=asOf){dropped++;continue;}
const b={time,end,open:number(a[1]),high:number(a[2]),low:number(a[3]),close:number(a[4]),volume:number(a[5]),quote:number(a[7]),buy:number(a[10])};
if(Math.min(b.open,b.high,b.low,b.close)<=0||b.high<Math.max(b.open,b.close,b.low)||b.low>Math.min(b.open,b.close,b.high)||b.volume<0||b.quote<0||b.buy<0||b.buy>b.quote*(1+1e-9))throw Error('Nến có giá hoặc khối lượng sai');
if(map.has(time)&&JSON.stringify(map.get(time))!==JSON.stringify(b))throw Error('Hai nến cùng ngày mâu thuẫn');map.set(time,b);}
const bars=[...map.values()].sort((a,b)=>a.time-b.time);if(bars.length<31)throw Error('Chưa đủ 31 nến ngày đã đóng');const tail=bars.slice(-31);for(let i=1;i<tail.length;i++)if(tail[i].time-tail[i-1].time!==DAY)throw Error('Thiếu ngày trong 31 ngày gần nhất');const recent=bars.slice(-7),q=recent.reduce((s,b)=>s+b.quote,0);if(q<=0)throw Error('Không có giá trị giao dịch trong 7 ngày');const last=bars.at(-1),lastIndex=bars.length-1;
return {bars,dropped,end:last.end,close:last.close,buyShare:recent.reduce((s,b)=>s+b.buy,0)/q,return7:last.close/bars[lastIndex-7].close-1,return30:last.close/bars[lastIndex-30].close-1,turnover:bars.slice(-20).reduce((s,b)=>s+b.quote,0)/20,stale:asOf-last.end>2*DAY};}
const api={DAY,number,stamp,symbols,parse};if(typeof module==='object'&&module.exports)module.exports=api;root.FlowPublic=api;
})(globalThis);

if(typeof document!=='undefined'){
'use strict';
const C=FlowPublic,$=s=>document.querySelector(s),PRESET=$('#symbols').value;
const state={rows:[],busy:false,at:null,blocked:false,cooldownUntil:0};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('vi-VN',{maximumFractionDigits:d}):'—';
const pct=v=>Number.isFinite(v)?(v>0?'+':'')+fmt(v*100)+'%':'—';
const rate=v=>Number.isFinite(v)?fmt(v*100)+'%':'—';
const date=t=>new Date(t).toISOString().slice(0,10);
const colored=v=>'<span class="'+(v<0?'negative':'positive')+'">'+pct(v)+'</span>';
function status(text,kind=''){const n=$('#status');n.textContent=text;n.className='status '+kind;}
function log(text){const n=$('#log');if(n.textContent==='Chưa gửi yêu cầu mạng.')n.textContent='';n.textContent+=new Date().toLocaleTimeString('vi-VN')+' · '+text+'\n';}
async function request(path,args={}){
if(!['time','exchangeInfo','klines'].includes(path))throw Error('Endpoint không được phép');
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),14000);
try{const url='https://data-api.binance.vision/api/v3/'+path+'?'+new URLSearchParams(args);const res=await fetch(url,{method:'GET',signal:controller.signal,credentials:'omit',cache:'no-store',headers:{Accept:'application/json'}});
if([418,429,451,403].includes(res.status)){state.blocked=true;const wait=Number(res.headers.get('Retry-After'));state.cooldownUntil=Date.now()+((wait>0&&Number.isFinite(wait)?Math.max(wait,60):60)*1000);throw Error('Nguồn giới hạn hoặc từ chối truy cập (HTTP '+res.status+'); dừng yêu cầu.');}
if(!res.ok)throw Error('API trả HTTP '+res.status);return await res.json();
}catch(e){if(e.name==='AbortError'){state.blocked=true;throw Error('API hết thời gian sau 14 giây');}if(e instanceof TypeError){state.blocked=true;throw Error('Không kết nối được API (mạng, CORS hoặc vùng truy cập).');}throw e;}finally{clearTimeout(timer);}}
async function load(){
if(state.busy)return;if(Date.now()<state.cooldownUntil){status('Nguồn yêu cầu chờ. Thử lại sau '+Math.ceil((state.cooldownUntil-Date.now())/1000)+' giây.','error');return;}let selected;try{selected=C.symbols($('#symbols').value);}catch(e){status(e.message,'error');return;}
state.busy=true;state.blocked=false;$('#load').disabled=true;$('#reset').disabled=true;$('#symbols').disabled=true;state.rows=[];render();status('Đang kiểm tra thời gian nguồn và trạng thái các mã spot…');
try{const clock=await request('time');state.at=C.stamp(clock.serverTime);if(Math.abs(state.at-Date.now())>15*60000)throw Error('Đồng hồ nguồn và máy lệch hơn 15 phút. Dừng để tránh gắn dữ liệu sai ngày.');const meta=await request('exchangeInfo');if(!Array.isArray(meta.symbols))throw Error('Không xác nhận được trạng thái niêm yết');const registry=new Map(meta.symbols.map(x=>[x.symbol,x]));let done=0;
for(const symbol of selected){if(state.blocked)break;try{const info=registry.get(symbol);if(!info||info.status!=='TRADING'||info.isSpotTradingAllowed===false||info.quoteAsset!=='USDT')throw Error('Không ở trạng thái spot/USDT được hỗ trợ');const raw=await request('klines',{symbol,interval:'1d',limit:'121'});const row=C.parse(raw,state.at);state.rows.push({...row,symbol});log(symbol+': '+row.bars.length+' nến đã đóng; bỏ '+row.dropped+' nến chưa đóng'+(row.stale?'; dữ liệu CŨ':''));}catch(e){log(symbol+': '+e.message);}done++;status('Đang đọc '+done+'/'+selected.length+' mã · '+state.rows.length+' chuỗi hợp lệ');await new Promise(r=>setTimeout(r,150));}
render();const fresh=state.rows.filter(r=>!r.stale).length;status('Đã đọc '+state.rows.length+'/'+selected.length+' mã, '+fresh+' mã còn mới. '+(state.blocked?'Đã dừng do lỗi truy cập; xem nhật ký. ':done>state.rows.length?'Một số mã thiếu dữ liệu hoặc không được hỗ trợ; xem nhật ký. ':'')+'Đây là thống kê spot, chưa xác nhận cá mập.',fresh&&!state.blocked&&state.rows.length===selected.length?'ok':'error');
}catch(e){status(e.message+' Không tạo dữ liệu thay thế.','error');log(e.message);}finally{state.busy=false;$('#load').disabled=false;$('#reset').disabled=false;$('#symbols').disabled=false;}}
function render(){
$('#count').textContent=state.rows.length||'—';$('#asof').textContent=state.rows.length?date(Math.max(...state.rows.map(r=>r.end))):'—';$('#fetched').textContent=state.rows.length?'Đọc: '+new Date(state.at).toLocaleString('vi-VN'):'Chỉ dùng nến đã đóng · UTC';
if(!state.rows.length){$('#table').className='empty';$('#table').innerHTML='<strong>Chưa có dữ liệu hợp lệ</strong><p>Đọc nguồn thật trước khi hiển thị kết quả.</p>';$('#scatter').className='chart-box empty';$('#scatter').innerHTML='<strong>Chưa có điểm dữ liệu</strong><p>Chỉ vẽ khi nguồn trả dữ liệu mới, đủ lịch sử.</p>';return;}
const rows=[...state.rows],sort=$('#sort').value;rows.sort((a,b)=>sort==='symbol'?a.symbol.localeCompare(b.symbol):b[sort]-a[sort]);$('#table').className='table-scroll';
$('#table').innerHTML='<table><thead><tr><th>Mã</th><th>Đóng cửa · USDT</th><th>Taker mua 7D</th><th>Giá 7D</th><th>Giá 30D</th><th>GD/ngày 20D · triệu USDT</th></tr></thead><tbody>'+rows.map(r=>'<tr><td><button class="asset" data-symbol="'+esc(r.symbol)+'">'+esc(r.symbol.replace(/USDT$/,''))+' ↗</button><div class="row-note '+(r.stale?'warning':'')+'">'+(r.stale?'Dữ liệu cũ · ':'')+date(r.end)+'</div></td><td>'+fmt(r.close,8)+'</td><td>'+rate(r.buyShare)+'</td><td>'+colored(r.return7)+'</td><td>'+colored(r.return30)+'</td><td>'+fmt(r.turnover/1e6)+'</td></tr>').join('')+'</tbody></table>';
scatter(rows.filter(r=>!r.stale));}
function scatter(rows){
const node=$('#scatter');if(!rows.length){node.className='chart-box empty';node.innerHTML='<strong>Không có dữ liệu mới để vẽ</strong>';return;}node.className='chart-box';
const W=1080,H=315,L=58,R=34,T=24,B=48,xs=rows.map(r=>r.return7*100),ys=rows.map(r=>r.buyShare*100),x0=Math.min(0,...xs),x1=Math.max(0,...xs),xp=Math.max(2,(x1-x0)*.12),lo=x0-xp,hi=x1+xp,yl=Math.max(0,Math.min(45,...ys)-2),yh=Math.min(100,Math.max(55,...ys)+2),X=v=>L+(v-lo)/(hi-lo)*(W-L-R),Y=v=>H-B-(v-yl)/(yh-yl)*(H-T-B);
let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Biến động giá 7 ngày và tỷ trọng taker mua 7 ngày">';for(let i=0;i<5;i++){const x=lo+(hi-lo)*i/4,y=yl+(yh-yl)*i/4;s+='<line class="grid" x1="'+X(x)+'" y1="'+T+'" x2="'+X(x)+'" y2="'+(H-B)+'"/><text text-anchor="middle" x="'+X(x)+'" y="'+(H-B+20)+'">'+x.toFixed(1)+'%</text><line class="grid" x1="'+L+'" y1="'+Y(y)+'" x2="'+(W-R)+'" y2="'+Y(y)+'"/><text text-anchor="end" x="'+(L-9)+'" y="'+(Y(y)+4)+'">'+y.toFixed(0)+'%</text>';}
s+='<line class="axis" x1="'+X(0)+'" y1="'+T+'" x2="'+X(0)+'" y2="'+(H-B)+'"/><line class="axis" x1="'+L+'" y1="'+Y(50)+'" x2="'+(W-R)+'" y2="'+Y(50)+'"/>';
for(const r of rows){const label=r.symbol.replace(/USDT$/,'');s+='<g class="point" data-symbol="'+esc(r.symbol)+'" tabindex="0" role="button" aria-label="'+esc(label)+'; giá 7 ngày '+pct(r.return7)+'; taker mua '+rate(r.buyShare)+'"><title>'+esc(label)+' · Giá 7D '+pct(r.return7)+' · Taker mua '+rate(r.buyShare)+'</title><circle cx="'+X(r.return7*100)+'" cy="'+Y(r.buyShare*100)+'" r="17"/><text x="'+X(r.return7*100)+'" y="'+(Y(r.buyShare*100)+3)+'">'+esc(label.length>5?label.slice(0,4)+'…':label)+'</text></g>';}
s+='<text x="'+(W/2)+'" y="'+(H-3)+'" text-anchor="middle">BIẾN ĐỘNG GIÁ 7 NGÀY</text><text x="'+L+'" y="13">TAKER MUA 7D</text></svg>';node.innerHTML=s;}
function showDetail(symbol){const r=state.rows.find(x=>x.symbol===symbol);if(!r)return;$('#detail-title').textContent=symbol.replace(/USDT$/,'')+' / USDT';const b=r.bars,W=760,H=240,L=66,T=20,B=32,R=15,lo=Math.min(...b.map(x=>x.close)),hi=Math.max(...b.map(x=>x.close)),pad=(hi-lo||hi)*.08,mn=lo-pad,mx=hi+pad,X=i=>L+i*(W-L-R)/(b.length-1),Y=v=>T+(mx-v)/(mx-mn)*(H-T-B);let s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Giá đóng cửa lịch sử">';for(let i=0;i<4;i++){const v=mn+(mx-mn)*i/3;s+='<line class="grid" x1="'+L+'" y1="'+Y(v)+'" x2="'+(W-R)+'" y2="'+Y(v)+'"/><text text-anchor="end" x="'+(L-9)+'" y="'+(Y(v)+4)+'">'+v.toPrecision(4)+'</text>';}
s+='<path class="price-line" d="'+b.map((v,i)=>(i?'L':'M')+X(i).toFixed(2)+','+Y(v.close).toFixed(2)).join(' ')+'"/><text x="'+L+'" y="'+(H-5)+'">'+date(b[0].time)+'</text><text text-anchor="end" x="'+(W-R)+'" y="'+(H-5)+'">'+date(r.end)+'</text></svg>';
$('#detail-body').innerHTML='<p class="small">Nến đã đóng · '+b.length+' ngày · '+(r.stale?'DỮ LIỆU CŨ':'Thời điểm nguồn: '+new Date(state.at).toLocaleString('vi-VN'))+'</p><div class="chart-box">'+s+'</div><div class="detail-stats"><p><span>Taker mua 7D</span><strong>'+rate(r.buyShare)+'</strong></p><p><span>Giá 7D</span><strong>'+pct(r.return7)+'</strong></p><p><span>Danh tính cá mập</span><strong>Chưa xác minh</strong></p><p><span>Bằng chứng còn giữ hàng</span><strong>Chưa có</strong></p></div><p class="note small">Đây là dữ liệu mô tả, không có điểm chiến lược, dự báo tăng giá hoặc lệnh mua. Mua thụ động không được thể hiện bằng tỷ trọng taker mua.</p><p class="small">Nguồn: data-api.binance.vision · /api/v3/klines · 1d</p>';
$('#detail').showModal();}
for(const parent of ['#table','#scatter']){$(parent).addEventListener('click',e=>{const t=e.target.closest('[data-symbol]');if(t)showDetail(t.dataset.symbol);});}
$('#scatter').addEventListener('keydown',e=>{const t=e.target.closest('[data-symbol]');if(t&&['Enter',' '].includes(e.key)){e.preventDefault();showDetail(t.dataset.symbol);}});
$('nav').addEventListener('click',e=>{const btn=e.target.closest('[data-panel]');if(!btn)return;document.querySelectorAll('.tab').forEach(n=>n.classList.toggle('active',n===btn));document.querySelectorAll('.panel').forEach(n=>n.hidden=n.id!==btn.dataset.panel);});
$('#load').addEventListener('click',load);$('#sort').addEventListener('change',render);$('#reset').addEventListener('click',()=>$('#symbols').value=PRESET);$('#close').addEventListener('click',()=>$('#detail').close());
}
