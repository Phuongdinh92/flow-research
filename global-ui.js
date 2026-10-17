/* Provider-wide USD reference, deliberately separate from individual USDT venues. */
(function(root){
'use strict';
const M=root.FlowMarketOverview||(typeof require==='function'?require('./market-overview.js'):null);
function selectRows(rows,options={}){if(!M)throw Error('Thiếu bộ trình bày thị trường');return M.selectGlobal(rows,options);}
root.FlowGlobalUI={selectRows};if(typeof module==='object'&&module.exports)module.exports=root.FlowGlobalUI;
})(globalThis);
if(typeof document!=='undefined'){
'use strict';
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt=(v,d=2)=>Number.isFinite(v)?v.toLocaleString('vi-VN',{maximumFractionDigits:d}):'—',money=v=>Number.isFinite(v)?fmt(v/1e9,3)+' tỷ USD':'—',pct=v=>Number.isFinite(v)?(v>0?'+':'')+fmt(v)+'%':'Thiếu dữ liệu',date=t=>Number.isFinite(t)?new Date(t).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false}):'—';
let snapshot=null,period='24h',view='bubbles',points=[],revision=0,busy=false,categories=null;
function render(){
 if(!snapshot)return;
 const options={query:$('#global-search').value,period,limit:$('#global-limit').value,sort:$('#global-sort').value,minVolume:Number($('#global-min-volume').value)||0};let result=FlowGlobalUI.selectRows(snapshot.global.pricedRows,options),historical=false;
 if(!result.available&&Date.now()-snapshot.generatedAt>900000){result=FlowGlobalUI.selectRows(snapshot.global.pricedRows,{...options,now:snapshot.generatedAt});historical=true;}points=result.allRows;
 const label=result.label,limit=options.limit==='all'?result.available:Number(options.limit),chartWidth=Math.max(320,$('#global-map').clientWidth||((globalThis.innerWidth||1280)-80)),shown=result.rows;
 if(view==='bubbles'){
  $('#global-map').innerHTML=shown.length>200?'<div class="market-bubble-pages">'+FlowMarketOverview.bubbleGrid(shown,{sizeBy:$('#global-size').value,windowLabel:label})+'</div>':shown.length?FlowChartsView.bubble(shown,{width:chartWidth,sizeBy:$('#global-size').value,windowLabel:label,maxItems:200}):'<div class="empty">Không có tài sản đủ dữ liệu khớp bộ lọc.</div>';
 }else $('#global-map').innerHTML=FlowMarketOverview.render(points,{mode:view,limit,windowLabel:label});
 for(const n of document.querySelectorAll('[data-global-period]')){const active=n.dataset.globalPeriod===period;n.classList.toggle('selected',active);n.setAttribute('aria-pressed',String(active));const info=FlowMarketOverview.PERIODS[n.dataset.globalPeriod];n.disabled=!info||!snapshot.global.pricedRows.some(r=>Number.isFinite(r[info.field]));}
 for(const n of document.querySelectorAll('[data-global-view]')){const active=n.dataset.globalView===view;n.classList.toggle('selected',active);n.setAttribute('aria-pressed',String(active));}
 const times=points.map(r=>r.providerUpdatedAt).filter(Number.isFinite),old=times.length?Math.min(...times):null,b=result.benchmark;
 $('#global-benchmark').innerHTML=b?'<strong>BTC · '+esc(label)+' '+pct(b.returnPct)+'</strong><span>CoinGecko ID: bitcoin · '+date(b.asOf)+'</span>':'Chưa có BTC đủ dữ liệu '+esc(label)+' cùng thời điểm để so sánh.';
 const plotted=view==='movers'?Math.min(10,points.filter(r=>r.x>0).length)+Math.min(10,points.filter(r=>r.x<0).length):view==='countertrend'?Math.min(limit,FlowMarketOverview.countertrend(points).length):shown.length;
 $('#global-meta').textContent=(historical?'BẢN LƯU ĐÃ CŨ · ':'')+'Hiện '+plotted+'/'+result.available+' tài sản đủ dữ liệu '+label+' trong bộ lọc. '+result.missing+' thiếu biến động/volume, dưới ngưỡng volume hoặc giá đã quá 15 phút tại thời điểm tham chiếu. '+(view==='bubbles'?($('#global-size').value==='turnover'?'Diện tích vòng tròn tỷ lệ volume 24H USD; cùng một thang cho tất cả tài sản đang hiện. ':'Bóng bằng nhau để dễ đọc; kích thước không thể hiện volume/vốn hóa. '):view==='movers'?'Xếp tăng/giảm theo % của đúng khung; dùng toàn bộ tài sản qua bộ lọc, không chỉ nhóm bóng đang hiện. ':view==='countertrend'?'Chỉ lấy mã có giá trái dấu BTC; loại trường hợp lệch timestamp quá 5 phút. ':'Chiều dài cột dùng chung thang % trong danh sách hiện. ')+'Thời gian nguồn: '+(old?date(old)+' → '+date(Math.max(...times)):'chưa có')+'.';
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
 $('#global-detail-body').innerHTML='<p>Định danh CoinGecko: <strong>'+esc(r.id)+'</strong> · Đơn vị USD · Nguồn cập nhật '+date(r.providerUpdatedAt)+'</p><div class="detail-stats"><p><span>Giá tổng hợp</span><strong>'+fmt(r.priceUsd,8)+' USD</strong></p><p><span>Vốn hóa theo nguồn</span><strong>'+money(r.marketCapUsd)+'</strong></p><p><span>Giá 1H</span><strong>'+pct(r.return1hPct)+'</strong></p><p><span>Giá 24H</span><strong>'+pct(r.return24hPct)+'</strong></p><p><span>Giá 7D</span><strong>'+pct(r.return7dPct)+'</strong></p><p><span>Giá 30D</span><strong>'+pct(r.return30dPct)+'</strong></p><p><span>Giá 1Y</span><strong>'+pct(r.return1yPct)+'</strong></p><p><span>Giá trị giao dịch 24H tổng hợp</span><strong>'+money(r.volume24hUsd)+'</strong></p></div><p class="note">Số liệu tổng hợp theo tài sản của CoinGecko. Không cộng lại với từng sàn ở bảng bên dưới; ticker giống nhau chưa xác nhận cùng hợp đồng. Đây chưa phải số token cá mập mua hoặc còn giữ.</p>';
 $('#global-detail').showModal();
}
function mountControls(){
 const controls=document.createElement('div');controls.className='market-mode-controls';controls.innerHTML='<div class="segmented" aria-label="Cách xem thị trường"><button data-global-view="bubbles" class="selected" aria-pressed="true">Bong bóng</button><button data-global-view="columns" aria-pressed="false">Cột</button><button data-global-view="movers" aria-pressed="false">Tăng / giảm mạnh</button><button data-global-view="countertrend" aria-pressed="false">Đi ngược BTC</button></div><label>Xếp theo<select id="global-sort"><option value="marketcap">Vốn hóa lớn</option><option value="volume">Volume 24H lớn</option><option value="gainers">Tăng mạnh</option><option value="losers">Giảm mạnh</option><option value="absolute">Biến động lớn</option></select></label><label>Volume 24H tối thiểu<select id="global-min-volume"><option value="0">Tất cả có volume</option><option value="1000000">1 triệu USD</option><option value="10000000">10 triệu USD</option><option value="100000000">100 triệu USD</option></select></label><label>Kích thước bóng<select id="global-size"><option value="equal">Bằng nhau · dễ đọc</option><option value="turnover">Diện tích theo volume 24H</option></select></label>';
 $('.global-controls').insertAdjacentElement('afterend',controls);
 const benchmark=document.createElement('p');benchmark.id='global-benchmark';benchmark.className='market-benchmark';controls.insertAdjacentElement('afterend',benchmark);
 const periods=$('[data-global-period]').parentElement;periods.insertAdjacentHTML('afterbegin','<button data-global-period="1h" aria-pressed="false">1 giờ</button>');periods.insertAdjacentHTML('beforeend','<button data-global-period="1y" aria-pressed="false">1 năm</button><button disabled title="Cần lịch sử giao dịch 15 phút của từng tài sản; nguồn tổng hợp này không cung cấp trường đó">15 phút · chưa có nguồn</button>');
 $('#global-limit').insertAdjacentHTML('beforeend','<option value="400">400 · bản đồ đầy đủ</option><option value="all">Tất cả qua bộ lọc</option>');
 for(const n of document.querySelectorAll('[data-global-view]'))n.addEventListener('click',()=>{view=n.dataset.globalView;render();});
 for(const id of ['#global-sort','#global-min-volume','#global-size'])$(id).addEventListener('change',render);
}
function renderCategories(){
 if(!categories)return;const q=$('#sector-search').value.trim().toLowerCase(),sort=$('#sector-sort').value,all=categories.rows.filter(r=>r.name.toLowerCase().includes(q)||r.id.includes(q)),rows=[...all].sort((a,b)=>sort==='gainers'?b.marketCapChange24hPct-a.marketCapChange24hPct:sort==='losers'?a.marketCapChange24hPct-b.marketCapChange24hPct:b.marketCapUsd-a.marketCapUsd).slice(0,Number($('#sector-limit').value));
 $('#sector-grid').innerHTML=rows.length?rows.map(r=>'<article class="market-sector-tile"><h3><a href="https://www.coingecko.com/en/categories/'+encodeURIComponent(r.id)+'" target="_blank" rel="noopener noreferrer">'+esc(r.name)+' ↗</a></h3><strong class="sector-change '+(r.marketCapChange24hPct>=0?'positive':'negative')+'">'+pct(r.marketCapChange24hPct)+'</strong><p>Biến động vốn hóa nhóm · 24H</p><dl><dt>Vốn hóa</dt><dd>'+FlowMarketOverview.human(r.marketCapUsd)+' USD</dd><dt>Volume 24H</dt><dd>'+FlowMarketOverview.human(r.volume24hUsd)+' USD</dd></dl><p>CoinGecko IDs đại diện: '+r.topCoinIds.map(esc).join(' · ')+'</p><p>Nguồn cập nhật '+date(r.providerUpdatedAt)+'</p></article>').join(''):'<p class="small">Không có nhóm ngành khớp tìm kiếm.</p>';
 $('#sector-status').textContent='Hiện '+rows.length+'/'+all.length+' nhóm khớp bộ lọc · '+categories.rows.length+'/'+categories.source.inputCount+' nhóm đủ số liệu · thu thập '+date(categories.generatedAt)+(Date.now()-categories.generatedAt>900000?' · BẢN LƯU QUÁ 15 PHÚT':'')+'.';
}
async function loadCategories(){
 const mount=$('#market-sector-overview');if(!mount)return;mount.className='card market-sector-card';mount.innerHTML='<div class="card-head"><div><div class="eyebrow">NHÓM NGÀNH / NARRATIVE · COINGECKO</div><h2>Nhóm nào đang mạnh?</h2><p class="small">Biến động vốn hóa và volume của nhóm theo nhà cung cấp.</p></div></div><div class="market-sector-controls"><label>Tìm nhóm ngành<input id="sector-search" type="search" placeholder="AI, Layer 1, DeFi, meme…" maxlength="80"></label><label>Xếp theo<select id="sector-sort"><option value="marketcap">Vốn hóa lớn</option><option value="gainers">Vốn hóa tăng mạnh</option><option value="losers">Vốn hóa giảm mạnh</option></select></label><label>Số nhóm<select id="sector-limit"><option value="18">18</option><option value="60">60</option><option value="1000">Tất cả</option></select></label></div><p id="sector-status" class="small" role="status">Đang kiểm tra nguồn nhóm ngành…</p><div id="sector-grid" class="market-sector-grid"></div><p class="small">Một tài sản có thể thuộc nhiều nhóm. Không cộng vốn hóa/volume các nhóm thành tổng thị trường. Thay đổi vốn hóa không phải tiền mới mua ròng hoặc bằng chứng cá mập; ba tài sản đại diện không phải danh sách thành viên đầy đủ. Bản quan sát ngành có thời điểm riêng; cập nhật giá ở trên không làm mới ngành.</p><details><summary>Nguồn nhóm ngành</summary><p id="sector-source" class="small proof-line"></p></details>';
 try{const r=await fetch('data/market-categories.json',{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('HTTP '+r.status);categories=FlowMarketOverview.validateCategories(await r.json());$('#sector-source').textContent=categories.source.url+' · SHA-256 '+categories.source.sha256;renderCategories();}catch(e){$('#sector-status').textContent='Chưa đọc được nhóm ngành: '+e.message+'. Không tự gán ngành từ ticker.';}
 $('#sector-search').addEventListener('input',renderCategories);for(const id of ['#sector-sort','#sector-limit'])$(id).addEventListener('change',renderCategories);
}
mountControls();
$('#global-refresh').addEventListener('click',()=>load(true));$('#global-search').addEventListener('input',render);$('#global-limit').addEventListener('change',render);$('#supply-window').addEventListener('change',renderSupply);
for(const n of document.querySelectorAll('[data-global-period]'))n.addEventListener('click',()=>{period=n.dataset.globalPeriod;render();});
$('#global-map').addEventListener('click',e=>{const n=e.target.closest('[data-key]');if(n)detail(n.dataset.key);});$('#global-map').addEventListener('keydown',e=>{const n=e.target.closest('[data-key]');if(n&&['Enter',' '].includes(e.key)){e.preventDefault();detail(n.dataset.key);}});$('#global-detail-close').addEventListener('click',()=>$('#global-detail').close());
$('nav').addEventListener('click',e=>{if(e.target.closest('[data-panel]')?.dataset.panel==='market')setTimeout(render,0);});
let resizeTimer;globalThis.addEventListener?.('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(render,300);});
setInterval(()=>{if(snapshot)render();},60000);
load();loadCategories();
}
