/* Source-verified research workspace. All datasets arrive through the existing
 * manifest/hash/schema-checked loader; this view starts no extra collection. */
(function(root,factory){'use strict';const api=factory(root);root.FlowAnalysisWorkspace=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(G){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const day=v=>Number.isFinite(v)?new Date(v).toISOString().slice(0,10):'—';
 const NATIVE_REFERENCES=Object.freeze({'binance:BTCUSDT':'btc','binance:ETHUSDT':'eth','binance:LTCUSDT':'ltc','binance:DOGEUSDT':'doge','binance:BCHUSDT':'bch','binance:DCRUSDT':'dcr','binance:ETCUSDT':'etc','binance:ZECUSDT':'zec','binance:DASHUSDT':'dash','binance:ADAUSDT':'ada'});
 function findHistory(dataset,key){const h=dataset?.data?.histories?.[key];return h&&h.key===key&&h.sourceId==='binance'&&h.quote==='USDT'?h:null;}
 function searchRows(dataset,query=''){
  const q=String(query).trim().toUpperCase();return Object.values(dataset?.data?.histories||{}).filter(h=>h.sourceId==='binance'&&h.quote==='USDT'&&(!q||h.base.toUpperCase().includes(q)||h.instrument.toUpperCase().includes(q))).sort((a,b)=>(b.base.toUpperCase()===q?1:0)-(a.base.toUpperCase()===q?1:0)||a.base.localeCompare(b.base)).slice(0,q?12:0);
 }
 function referenceFor(snapshot,key){const id=NATIVE_REFERENCES[key];return id&&snapshot?.assets?.find(a=>a.id===id&&a.sourceId==='coinmetrics'&&a.identity?.scope==='native-network')||null;}
 function mount(host,{onOpenToken=()=>{}}={}){
  if(!host)return null;
  const state={dataset:null,key:'binance:HBARUSDT',costReference:null,holderHistory:null,holders:null,ledger:null,inventory:null,marketNative:null,holderIdentities:null,errors:{},views:{},query:'',destroyed:false,identityRequested:false};
  host.classList.add('analysis-workspace');
  host.innerHTML='<div class="aw-hero"><div><span class="aw-kicker"><i></i> FLOW / RESEARCH INTELLIGENCE</span><h2>Dòng tiền & cấu trúc giá</h2><p>Đọc lực mua trên thị trường, rồi kiểm tra số dư và giao dịch của từng tài sản.</p></div><span class="aw-date" data-aw-date>Đang kiểm tra dữ liệu…</span></div><nav class="aw-nav" aria-label="Các lớp phân tích"><button type="button" data-aw-scroll="aw-overview"><b>01</b> Tổng quan</button><button type="button" data-aw-scroll="aw-capital"><b>02</b> Giá & dòng tiền</button><button type="button" data-aw-scroll="aw-holder"><b>03</b> Holder Flow</button><button type="button" data-aw-scroll="aw-wallet"><b>04</b> Liên kết ví</button></nav><div id="aw-overview" class="aw-overview-tabs"><div role="group" aria-label="Nguồn tổng quan"><button type="button" data-aw-overview="onchain" aria-pressed="true">Ví on-chain <small>Số dư thật</small></button><button type="button" data-aw-overview="exchange" aria-pressed="false">Thị trường sàn <small>Lực khớp lệnh</small></button></div></div><section id="aw-onchain" class="aw-section" aria-label="Tổng quan thay đổi số dư on-chain"><div class="aw-loading">Đang kiểm tra các mốc số dư HBAR và TON…</div></section><section id="aw-strength" hidden class="aw-section" aria-label="Bản đồ lực mua"><div class="aw-loading">Đang kiểm tra danh mục nến và nguồn khớp lệnh…</div></section><div class="aw-token-toolbar"><div><span class="aw-kicker">PHÂN TÍCH TÀI SẢN</span><h3 data-aw-token-name>HBAR <small>Binance / USDT</small></h3></div><div class="aw-search"><label for="aw-token-search">Tìm cặp giao dịch</label><input id="aw-token-search" type="search" maxlength="80" placeholder="HBAR, BTC, S, WLD…" autocomplete="off" aria-controls="aw-search-results"><div id="aw-search-results" role="list" hidden></div></div><div class="aw-shortcuts"><button type="button" data-aw-token="binance:HBARUSDT" aria-pressed="true">HBAR <small>Holder</small></button><button type="button" data-aw-token="binance:BTCUSDT" aria-pressed="false">BTC <small>Realized</small></button><button type="button" data-aw-token="binance:ETHUSDT" aria-pressed="false">ETH <small>Realized</small></button><button type="button" data-aw-terminal>Chi tiết nguồn ↗</button></div></div><p class="aw-observation" data-aw-observation role="status">Biểu đồ sử dụng ngày UTC đã đóng; thời điểm nguồn được giữ trên từng lớp.</p><section id="aw-capital" class="aw-section" aria-label="Cấu trúc giá và dòng khớp lệnh"><div class="aw-loading">Đang nạp biểu đồ giá…</div></section><section id="aw-holder" class="aw-section" aria-label="Lịch sử số dư holder"><div class="aw-loading">Đang kiểm tra lịch sử số dư HBAR…</div></section><section id="aw-wallet" class="aw-section" aria-label="Liên kết giao dịch trên Ethereum"><div class="aw-loading">Đang kiểm tra receipt và sổ giao dịch…</div></section><details class="aw-method"><summary>Đối chiếu với các nhóm biểu đồ tham chiếu</summary><div class="aw-method-table"><table><thead><tr><th>Nhóm trong ảnh</th><th>Số đo đang triển khai</th><th>Phần cần thêm bằng chứng</th></tr></thead><tbody><tr><td>ASI</td><td>Tỷ trọng mua chủ động 0–1 và mua − bán, theo cặp Binance.</td><td>Danh sách strategic traders, công thức ASI, vốn hóa khớp định danh.</td></tr><tr><td>Smart Bands</td><td>Nến, volume, EMA50/200; Realized toàn mạng ở nguồn USD riêng.</td><td>Công thức Balance, Delta, Undervalue, Diamond.</td></tr><tr><td>Money Flow Index</td><td>Delta khớp lệnh, cường độ volume và sự kiện có quy tắc công khai.</td><td>Công thức MFI riêng, Whale/Shark Action, LNC.</td></tr><tr><td>Holder Flow</td><td>Thay đổi số dư nhóm tài khoản HBAR cố định theo thứ hạng đầu kỳ.</td><td>Lịch sử cùng độ phủ cho S/BTW và cách A1 tính Activity Share.</td></tr><tr><td>Clustering Wallets</td><td>Liên kết transfer trong receipt, biên vào/ra nhóm trong mẫu Ethereum.</td><td>Quan hệ cùng chủ, hành vi phối hợp và toàn bộ lịch sử ví.</td></tr></tbody></table></div><p>Các phép tính tại đây có tên và đơn vị riêng. Chưa xác nhận kết quả bằng mô hình A1 hoặc khả năng dự báo lợi nhuận.</p></details>';
  const $=selector=>host.querySelector(selector), viewHost=id=>$('#aw-'+id);
  function missing(title,body,action=''){return '<div class="aw-unavailable"><div class="aw-empty-mark">◇</div><div><h3>'+esc(title)+'</h3><p>'+esc(body)+'</p>'+action+'</div></div>';}
  function guard(name,fn){try{fn();delete state.errors[name];}catch(error){state.views[name]?.destroy?.();delete state.views[name];state.errors[name]=error.message;const id={capital:'capital',holder:'holder',wallet:'wallet',strength:'strength',onchain:'onchain'}[name];if(id)viewHost(id).innerHTML=missing('Chưa hiển thị được lớp dữ liệu',error.message);}}
  function upsert(name,api,args){const el=viewHost(name);if(!api?.mount)throw Error('Chưa tải được thành phần biểu đồ '+name+'.');if(state.views[name]?.update)state.views[name].update(args);else{state.views[name]?.destroy?.();state.views[name]=api.mount(el,args);}}
  function paintToken(){
   const h=findHistory(state.dataset,state.key);if(!h)return;
   $('[data-aw-token-name]').innerHTML=esc(h.base)+' <small>Binance / USDT</small>';
   for(const b of host.querySelectorAll('[data-aw-token]'))b.setAttribute('aria-pressed',String(b.dataset.awToken===state.key));
   const end=h.bars.at(-1)?.end,last=h.bars.at(-1)?.close;
   $('[data-aw-observation]').textContent=h.instrument+' · '+h.bars.length+' nến ngày · đóng cuối '+day(end)+' UTC · giá đóng '+(Number.isFinite(last)?last.toLocaleString('en-US',{maximumSignificantDigits:10}):'—')+' USDT'+(end<Math.floor(Date.now()/86400000)*86400000-1?' · Bản lưu, chưa phải giá trực tiếp.':'.');
   guard('capital',()=>upsert('capital',G.FlowCapitalFlowView,{history:h,costAsset:referenceFor(state.costReference,state.key)}));
   paintHolder();
  }
  function paintHolder(){
   if(state.key!=='binance:HBARUSDT'){
    state.views.holder?.destroy?.();delete state.views.holder;
    viewHost('holder').innerHTML=missing('Holder Flow · '+(findHistory(state.dataset,state.key)?.base||''),'Chưa có lịch sử số dư đã xác minh cho tài sản này. Mở HBAR để xem nhóm Top 1–100 đến 501–1000 với dữ liệu thật.','<button type="button" data-aw-token="binance:HBARUSDT">Xem Holder Flow HBAR →</button>');return;
   }
   if(!state.holderHistory)return;
   guard('holder',()=>upsert('holder',G.FlowHolderFlowView,{snapshot:state.holderHistory,priceHistory:findHistory(state.dataset,'binance:HBARUSDT')}));
  }
  function paintWalletStrength(){if(!state.holderHistory&&!state.holders){if(state.errors.holderHistory||state.errors.holders){state.views.onchain?.destroy?.();delete state.views.onchain;viewHost('onchain').innerHTML=missing('Chưa đọc được số dư on-chain',[state.errors.holderHistory,state.errors.holders].filter(Boolean).join(' · '));}return;}guard('onchain',()=>upsert('onchain',G.FlowWalletStrengthView,{holderHistory:state.holderHistory,holders:state.holders,marketSnapshot:state.marketNative,identities:state.holderIdentities,canOpen:row=>!!findHistory(state.dataset,({'hedera-hbar':'binance:HBARUSDT',not:'binance:NOTUSDT',dogs:'binance:DOGSUSDT'})[row.id]),onOpen:row=>select(({'hedera-hbar':'binance:HBARUSDT',not:'binance:NOTUSDT',dogs:'binance:DOGSUSDT'})[row.id],{scroll:true})}));}
  function paintWallet(){if(!state.ledger||!state.inventory){if(state.errors.ledger||state.errors.inventory){state.views.wallet?.destroy?.();delete state.views.wallet;viewHost('wallet').innerHTML=missing('Chưa kiểm tra được sổ giao dịch',[state.errors.ledger,state.errors.inventory].filter(Boolean).join(' · '));}return;}guard('wallet',()=>upsert('wallet',G.FlowWalletCohorts,{chain:state.ledger,inventory:state.inventory}));}
  function select(key,{scroll=false}={}){
   if(!findHistory(state.dataset,key))return false;
   state.key=key;state.query='';$('#aw-token-search').value='';$('#aw-search-results').hidden=true;paintToken();if(scroll)viewHost('capital').scrollIntoView({behavior:'smooth',block:'start'});return true;
  }
  function click(e){
   const overview=e.target.closest('[data-aw-overview]');if(overview){const wallet=overview.dataset.awOverview==='onchain';viewHost('onchain').hidden=!wallet;viewHost('strength').hidden=wallet;for(const button of host.querySelectorAll('[data-aw-overview]'))button.setAttribute('aria-pressed',String(button===overview));return;}
   const token=e.target.closest('[data-aw-token]');if(token){select(token.dataset.awToken);return;}
   const nav=e.target.closest('[data-aw-scroll]');if(nav){host.querySelector('#'+nav.dataset.awScroll)?.scrollIntoView({behavior:'smooth',block:'start'});return;}
   if(e.target.closest('[data-aw-terminal]'))onOpenToken(state.key);
  }
  function search(e){if(e.target.id!=='aw-token-search')return;state.query=e.target.value;const rows=searchRows(state.dataset,state.query),list=$('#aw-search-results');list.hidden=!state.query.trim();list.innerHTML=rows.length?rows.map(h=>'<button type="button" role="listitem" data-aw-token="'+esc(h.key)+'"><strong>'+esc(h.base)+'</strong><small>'+esc(h.instrument)+' · Binance</small></button>').join(''):'<p>Không có cặp trong bản đã thu thập.</p>';}
  function keydown(e){if(e.key==='Escape')$('#aw-search-results').hidden=true;if(e.key==='Enter'&&e.target.id==='aw-token-search'){const rows=searchRows(state.dataset,e.target.value);if(rows.length===1||rows[0]?.base.toUpperCase()===e.target.value.trim().toUpperCase()){e.preventDefault();select(rows[0].key);}}}
  host.addEventListener('click',click);host.addEventListener('input',search);host.addEventListener('keydown',keydown);
  function setDataset(result){
   if(state.destroyed||result?.preview)return;
   if(!result?.data?.histories||!result.manifest)throw Error('Thiếu bản dữ liệu đã xác minh.');
   state.dataset=result;
   if(!findHistory(result,state.key))state.key=Object.values(result.data.histories).find(h=>h.sourceId==='binance'&&h.quote==='USDT')?.key;
   $('[data-aw-date]').textContent='NẾN ĐÓNG · '+day(result.data.endTime)+' UTC';
   guard('strength',()=>{const args={dataset:result,onOpen:key=>select(key,{scroll:true})};if(state.views.strength?.setDataset)state.views.strength.setDataset(result);else upsert('strength',G.FlowStrengthOverview,args);});
   paintToken();loadIdentity();
  }
  async function loadIdentity(){
   if(state.identityRequested)return;state.identityRequested=true;
   try{const [bindings,market,identities]=await Promise.all([G.FlowPublicData.loadJSON('./data/exchange-identity.json',{validate:G.FlowExchangeIdentity.validateSnapshot}),G.FlowPublicData.loadJSON('./data/ecosystem-snapshot.json',{validate:G.FlowEcosystem.validateSnapshot}),G.FlowPublicData.loadJSON('./data/holder-market-identities.json',{validate:d=>{if(d?.schemaVersion!==1||d.kind!=='holder-market-identity-bindings'||!Array.isArray(d.bindings))throw Error('Định danh holder không hợp lệ.');return d;}})]);if(state.destroyed)return;state.marketNative=market;state.holderIdentities=identities;state.views.strength?.setIdentity?.({bindings,marketSnapshot:G.FlowCoinGeckoMarket.fromSnapshot(market)});paintWalletStrength();}catch(error){state.errors.identity=error.message;}
  }
  function setSupplement(name,value,error){
   if(state.destroyed||!['holderHistory','holders','costReference','ledger','inventory'].includes(name))return;
   state[name]=value||null;
   if(error){state.errors[name]=String(error);if(name==='holderHistory'){state.views.holder?.destroy?.();delete state.views.holder;viewHost('holder').innerHTML=missing('Dữ liệu chưa qua kiểm tra',String(error));}if(['holders','holderHistory'].includes(name))paintWalletStrength();if(['ledger','inventory'].includes(name))paintWallet();if(name==='costReference')paintToken();return;}delete state.errors[name];
   if(name==='holderHistory'){paintHolder();paintWalletStrength();}else if(name==='holders')paintWalletStrength();else if(name==='costReference')paintToken();else paintWallet();
  }
  function setError(message){$('[data-aw-date]').textContent=state.dataset?'LỖI ĐỌC LẠI · giữ bản đã kiểm tra':'LỖI ĐỌC DỮ LIỆU';if(!state.dataset)for(const id of ['strength','onchain','capital','holder','wallet'])viewHost(id).innerHTML=missing('Không đọc được dữ liệu',message);}
  function setLoading(){if(state.dataset)$('[data-aw-date]').textContent='ĐANG ĐỌC LẠI · giữ bản đã kiểm tra';}
  function destroy(){state.destroyed=true;for(const view of Object.values(state.views))view?.destroy?.();host.removeEventListener('click',click);host.removeEventListener('input',search);host.removeEventListener('keydown',keydown);}
  return {setDataset,setSupplement,setError,setLoading,select,destroy};
 }
 return Object.freeze({NATIVE_REFERENCES,findHistory,searchRows,referenceFor,mount});
});
