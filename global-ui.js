/* Provider-wide USD reference, deliberately separate from individual USDT venues. */
(function(root){
'use strict';
function selectRows(rows,{query='',period='24h',limit=40,now=Date.now()}={}){
 const q=query.trim().toLowerCase(),field={ '24h':'return24hPct','7d':'return7dPct','30d':'return30dPct'}[period];
 if(!field)throw Error('Khung giá không hợp lệ');
 const matching=rows.filter(r=>!q||[r.id,r.symbol,r.name].some(v=>String(v).toLowerCase().includes(q)));
 const available=matching.filter(r=>Number.isFinite(r[field])&&r[field]>=-100&&r.volume24hUsd>0&&Number.isFinite(r.providerUpdatedAt)&&now-r.providerUpdatedAt<=900000&&r.providerUpdatedAt<=now+60000);
 available.sort((a,b)=>(b.marketCapUsd||0)-(a.marketCapUsd||0)||a.id.localeCompare(b.id));
 return {matching:matching.length,available:available.length,missing:matching.length-available.length,rows:available.slice(0,limit).map(r=>({...r,key:'coingecko:'+r.id,sourceId:'coingecko',sourceName:'CoinGecko',base:r.symbol.toUpperCase(),instrument:r.id,quote:'USD',x:r[field]/100,y:r.volume24hUsd,last:r.priceUsd,asOf:r.providerUpdatedAt,windowLabel:{'24h':'24H','7d':'7 ngày','30d':'30 ngày'}[period]}))};
}
root.FlowGlobalUI={selectRows};if(typeof module==='object'&&module.exports)module.exports=root.FlowGlobalUI;
})(globalThis);
if(typeof document!=='undefined'){
'use strict';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('vi-VN',{maximumFractionDigits:d}):'—',money=v=>Number.isFinite(v)?fmt(v/1e9,3)+' tỷ USD':'—',pct=v=>Number.isFinite(v)?(v>0?'+':'')+fmt(v)+'%':'Thiếu dữ liệu',date=t=>Number.isFinite(t)?new Date(t).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}):'—';
let snapshot=null,period='24h',points=[],revision=0,busy=false;
function render(){
 if(!snapshot)return;
 const options={query:$('#global-search').value,period,limit:Number($('#global-limit').value)||40};let result=FlowGlobalUI.selectRows(snapshot.global.pricedRows,options),historical=false;
 if(!result.available&&Date.now()-snapshot.generatedAt>900000){result=FlowGlobalUI.selectRows(snapshot.global.pricedRows,{...options,now:snapshot.generatedAt});historical=true;}points=result.rows;
 $('#global-map').innerHTML=points.length?FlowChartsView.bubble(points,{width:Math.max(320,$('#global-map').clientWidth||1200),sizeBy:'equal',windowLabel:points[0].windowLabel}):'<div class="empty">Không có tài sản đủ dữ liệu khớp bộ lọc.</div>';
 for(const n of document.querySelectorAll('[data-global-period]')){const active=n.dataset.globalPeriod===period;n.classList.toggle('selected',active);n.setAttribute('aria-pressed',String(active));}
 const times=points.map(r=>r.providerUpdatedAt).filter(Number.isFinite),old=times.length?Math.min(...times):null;
 $('#global-meta').textContent=(historical?'BẢN LƯU ĐÃ CŨ · ':'')+'Hiển thị '+points.length+'/'+result.available+' tài sản có số liệu '+{'24h':'24H','7d':'7D','30d':'30D'}[period]+' khớp bộ lọc, ưu tiên vốn hóa lớn. '+result.missing+' thiếu biến động/volume hoặc giá đã quá 15 phút tại thời điểm tham chiếu. Bóng bằng nhau để dễ đọc; màu và số là biến động giá, kích thước không thể hiện volume/vốn hóa. Thời gian cập nhật của tài sản đang hiển thị: '+(old?date(old)+' → '+date(Math.max(...times)):'chưa có')+'.';
 $('#global-coverage').textContent=fmt(snapshot.global.pricedCount,0)+' tài sản có giá trong bản đọc này / '+fmt(snapshot.global.catalogCount,0)+' mã trong danh mục CoinGecko. Giá là dữ liệu tổng hợp của nhà cung cấp bằng USD, giữ riêng với từng cặp USDT trên sàn; đây chưa phải quét toàn bộ danh mục hoặc bằng chứng ví.';
 $('#global-priced').textContent=fmt(snapshot.global.pricedCount,0);$('#global-catalog').textContent=fmt(snapshot.global.catalogCount,0);$('#ecosystem-count').textContent=fmt(snapshot.chains.filter(c=>c.tvlUsd!==null).length,0);
 $('#global-updated').textContent='Ghép bản dữ liệu lúc '+date(snapshot.generatedAt)+' · '+(Date.now()-snapshot.generatedAt>900000?'Bản lưu quá 15 phút; bấm cập nhật để kiểm tra nguồn.':'Bản đọc có thời điểm nguồn; không phải giá trực tiếp liên tục.');
 const top=[...snapshot.chains].filter(c=>Number.isFinite(c.tvlUsd)).sort((a,b)=>b.tvlUsd-a.tvlUsd).slice(0,10);
 $('#chains-table').innerHTML='<table><thead><tr><th>Chuỗi</th><th>TVL · tỷ USD</th><th>Cung stablecoin · tỷ USD</th></tr></thead><tbody>'+top.map(c=>'<tr><td>'+esc(c.chain)+'</td><td>'+fmt(c.tvlUsd/1e9,3)+'</td><td>'+fmt(c.stablecoinSupplyUsd===null?null:c.stablecoinSupplyUsd/1e9,3)+'</td></tr>').join('')+'</tbody></table>';
 $('#chains-meta').textContent='Bản TVL lấy lúc '+date(snapshot.provenance.find(p=>p.id==='defillama_chain_tvl')?.fetchedAt)+'; stablecoin theo chuỗi lấy lúc '+date(snapshot.provenance.find(p=>p.id==='defillama_chain_stablecoins')?.fetchedAt)+'. Cập nhật giá CoinGecko không làm mới các bản quan sát này.';
 renderSupply();
}
function renderSupply(){
 if(!snapshot)return;const days=Number($('#supply-window').value)||90,all=snapshot.stablecoinHistory,series=all.slice(-days),w=960,h=245,left=70,right=935,top=20,bottom=205;
 if(!series.length){$('#supply-chart').innerHTML='<p>Chưa có lịch sử cung stablecoin.</p>';return;}
 const values=series.map(r=>r.supplyUsd),low=Math.min(...values),high=Math.max(...values),pad=Math.max((high-low)*.12,high*.002,1),lo=Math.max(0,low-pad),hi=high+pad;
 const x=i=>left+i/Math.max(1,series.length-1)*(right-left),y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
 let svg='<svg class="chart-svg" viewBox="0 0 960 245" role="img" aria-label="Giá trị stablecoin lưu hành theo DefiLlama, đơn vị USD"><title>Giá trị stablecoin lưu hành, không phải dòng tiền mua token</title>';
 for(let i=0;i<4;i++){const v=lo+(hi-lo)*i/3,py=y(v);svg+='<line class="chart-grid" x1="'+left+'" y1="'+py+'" x2="'+right+'" y2="'+py+'"/><text x="60" y="'+(py+4)+'" text-anchor="end">'+fmt(v/1e9,1)+' tỷ</text>';}
 svg+='<path class="chart-cvd-line" d="'+series.map((r,i)=>(i?'L':'M')+x(i)+','+y(r.supplyUsd)).join(' ')+'"/>';
 for(let i=0;i<series.length;i++){const r=series[i];svg+='<circle class="chart-price-sample" cx="'+x(i)+'" cy="'+y(r.supplyUsd)+'" r="4"><title>'+new Date(r.time).toISOString().slice(0,10)+': '+r.supplyUsd+' USD</title></circle>';}
 svg+='<text x="70" y="233">'+new Date(series[0].time).toISOString().slice(0,10)+'</text><text x="935" y="233" text-anchor="end">'+new Date(series.at(-1).time).toISOString().slice(0,10)+'</text></svg>';
 $('#supply-chart').innerHTML=svg;
 const last=all.at(-1),target=last.time-7*86400000,prior=all.find(r=>r.time===target),change=prior?last.supplyUsd-prior.supplyUsd:null;
 $('#supply-meta').textContent='Giá trị mới nhất '+money(last.supplyUsd)+' · '+new Date(last.time).toISOString().slice(0,10)+' UTC'+(change!==null?' · Thay đổi 7 ngày '+(change>0?'+':'')+money(change):'')+'. Đây là thay đổi định giá lượng lưu hành, có thể gồm phát hành/thu hồi, tỷ giá và depeg; không quy thành tiền mới mua altcoin hoặc cá mập tích lũy. TVL cũng không đồng nghĩa dòng tiền nạp/rút. Bản quan sát stablecoin lấy lúc '+date(snapshot.provenance.find(p=>p.id==='stablecoinHistory')?.fetchedAt||snapshot.provenance.find(p=>p.sourceUrl.includes('stablecoincharts'))?.fetchedAt)+'.';
}
async function load(live=false){
 if(busy)return;busy=true;$('#global-refresh').disabled=true;const seq=++revision;
 try{
  $('#global-status').textContent=live?'Đang đọc dữ liệu tham chiếu từ nhà cung cấp…':'Đang mở bản tham chiếu nhiều thị trường…';
  const data=live?await FlowEcosystem.refresh(snapshot):await FlowEcosystem.loadSnapshot('data/ecosystem-snapshot.json');
  if(seq!==revision)return;snapshot=data;render();$('#global-status').textContent='Đã đọc '+fmt(snapshot.global.pricedCount,0)+' tài sản có giá. Độ phủ được ghi bên dưới; chưa có bằng chứng ví.';
 }catch(e){$('#global-status').textContent='Không đọc mới được: '+e.message+(snapshot?'. Giữ nguyên bản lưu và thời điểm cũ.':'. Không tạo dữ liệu thay thế.');}finally{busy=false;$('#global-refresh').disabled=false;}
}
function detail(key){
 const r=points.find(p=>p.key===key);if(!r)return;
 $('#global-detail-title').textContent=r.name+' · '+r.base;
 $('#global-detail-body').innerHTML='<p>Định danh CoinGecko: <strong>'+esc(r.id)+'</strong> · Đơn vị USD · Nguồn cập nhật '+date(r.providerUpdatedAt)+'</p><div class="detail-stats"><p><span>Giá tổng hợp</span><strong>'+fmt(r.priceUsd,8)+' USD</strong></p><p><span>Vốn hóa theo nguồn</span><strong>'+money(r.marketCapUsd)+'</strong></p><p><span>Giá 24H</span><strong>'+pct(r.return24hPct)+'</strong></p><p><span>Giá 7D</span><strong>'+pct(r.return7dPct)+'</strong></p><p><span>Giá 30D</span><strong>'+pct(r.return30dPct)+'</strong></p><p><span>Giá trị giao dịch 24H tổng hợp</span><strong>'+money(r.volume24hUsd)+'</strong></p></div><p class="note">Số liệu tổng hợp theo tài sản của CoinGecko. Không cộng lại với từng sàn ở bảng bên dưới; ticker giống nhau chưa xác nhận cùng hợp đồng. Đây chưa phải số token cá mập mua hoặc còn giữ.</p>';
 $('#global-detail').showModal();
}
$('#global-refresh').addEventListener('click',()=>load(true));$('#global-search').addEventListener('input',render);$('#global-limit').addEventListener('change',render);$('#supply-window').addEventListener('change',renderSupply);
for(const n of document.querySelectorAll('[data-global-period]'))n.addEventListener('click',()=>{period=n.dataset.globalPeriod;render();});
$('#global-map').addEventListener('click',e=>{const n=e.target.closest('[data-key]');if(n)detail(n.dataset.key);});$('#global-map').addEventListener('keydown',e=>{const n=e.target.closest('[data-key]');if(n&&['Enter',' '].includes(e.key)){e.preventDefault();detail(n.dataset.key);}});$('#global-detail-close').addEventListener('click',()=>$('#global-detail').close());
load();
}
