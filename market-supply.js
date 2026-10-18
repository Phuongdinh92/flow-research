/* Source-reported CoinGecko supply and arithmetic valuation ratios.
 * Ratios do not estimate unlock dates, locked balances or a risk score. */
(function(root,factory){'use strict';const api=factory();root.FlowMarketSupply=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
 'use strict';
 const FIELDS=Object.freeze(['marketCapUsd','fdvUsd','circulatingSupply','totalSupply','maxSupply']);
 const finite=x=>typeof x==='number'&&Number.isFinite(x),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={fdv_below_cap:'FDV thấp hơn vốn hóa',circulating_above_total:'Lưu hành lớn hơn tổng cung',circulating_above_max:'Lưu hành lớn hơn cung tối đa',total_above_max:'Tổng cung lớn hơn cung tối đa',zero_total:'Tổng cung nguồn báo bằng 0',zero_max:'Cung tối đa nguồn báo bằng 0'};
 function analyze(row,proof){
  const unavailable=reason=>({available:false,reason,raw:null,ratios:null,issues:[]});
  if(row?.sourceId!=='coingecko'||typeof row.id!=='string'||row.key!=='coingecko:'+row.id)return unavailable('Chưa có nguồn cung cho đúng định danh CoinGecko.');
  let u;try{u=new URL(row.sourceUrl);}catch{return unavailable('Thiếu bằng chứng nguồn cung.');}
  const receivedAt=row.receivedAt??row.fetchedAt,ids=u.searchParams.get('ids')?.split(',');
  if(u.origin!=='https://api.coingecko.com'||u.pathname!=='/api/v3/coins/markets'||u.username||u.password||u.hash||u.searchParams.get('vs_currency')!=='usd'||ids&&!ids.includes(row.id)||!ids&&Number(u.searchParams.get('page'))!==row.sourcePage||!proof||!/^[a-f0-9]{64}$/.test(row.sourceSha256||'')||proof.sha256!==row.sourceSha256||proof.url!==row.sourceUrl||proof.receivedAt!==receivedAt||!finite(row.providerUpdatedAt)||!finite(receivedAt))return unavailable('Chưa khớp bằng chứng nguồn cung với tài sản này.');
  if(FIELDS.some(k=>row[k]!=null&&(!finite(row[k])||row[k]<0)))return unavailable('Nguồn cung có trường số không hợp lệ.');
  const raw=Object.fromEntries(FIELDS.map(k=>[k,row[k]??null])),issues=[];
  if(raw.fdvUsd!==null&&raw.marketCapUsd!==null&&raw.fdvUsd<raw.marketCapUsd)issues.push('fdv_below_cap');
  for(const [a,b,code]of [['circulatingSupply','totalSupply','circulating_above_total'],['circulatingSupply','maxSupply','circulating_above_max'],['totalSupply','maxSupply','total_above_max']])if(raw[a]!==null&&raw[b]!==null&&raw[a]>raw[b])issues.push(code);
  if(raw.totalSupply===0)issues.push('zero_total');if(raw.maxSupply===0)issues.push('zero_max');
  const ratio=(a,b,scale=1)=>raw[a]!==null&&raw[b]>0&&finite(raw[a]/raw[b]*scale)?raw[a]/raw[b]*scale:null;
  return {available:true,raw,ratios:{fdvToCap:ratio('fdvUsd','marketCapUsd'),circulatingToTotalPct:ratio('circulatingSupply','totalSupply',100),circulatingToMaxPct:ratio('circulatingSupply','maxSupply',100)},issues,source:{id:row.id,sha256:row.sourceSha256,url:row.sourceUrl,providerUpdatedAt:row.providerUpdatedAt,receivedAt},hasSupply:FIELDS.slice(1).some(k=>raw[k]!==null)};
 }
 function number(value){return value===null||value===undefined?'—':new Intl.NumberFormat('vi-VN',{maximumSignificantDigits:15}).format(value);}
 function ratio(value,suffix){return value===null?'—':new Intl.NumberFormat('vi-VN',{maximumFractionDigits:2}).format(value)+suffix;}
 function stamp(value){return new Date(value).toLocaleString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh',hour12:false})+' VN';}
 function amount(value,unit=''){return '<span title="'+esc(value===null?'Nguồn chưa cung cấp':'Giá trị JSON: '+String(value))+'">'+esc(number(value))+(value===null?'':esc(unit))+'</span>';}
 function warnings(model){return model.issues.length?'<p class="hub-supply-warning">Nguồn cần đối chiếu: '+model.issues.map(k=>esc(labels[k])).join('; ')+'.</p>':'';}
 function renderPanel(row,proof){
  const m=analyze(row,proof);if(!m.available)return '<section class="hub-supply"><h3>Nguồn cung & định giá</h3><p>'+esc(m.reason)+'</p></section>';
  const v=m.raw,r=m.ratios;
  return '<section class="hub-supply"><h3>Nguồn cung & định giá</h3><div class="hub-supply-ratios"><div><span>FDV / Vốn hóa</span><strong>'+ratio(r.fdvToCap,'×')+'</strong></div><div><span>Lưu hành / Tổng cung</span><strong>'+ratio(r.circulatingToTotalPct,'%')+'</strong></div><div><span>Lưu hành / Tối đa</span><strong>'+ratio(r.circulatingToMaxPct,'%')+'</strong></div></div><dl>'+[['Vốn hóa',v.marketCapUsd,' USD'],['FDV do nguồn báo',v.fdvUsd,' USD'],['Lưu hành',v.circulatingSupply,''],['Tổng cung',v.totalSupply,''],['Cung tối đa',v.maxSupply,'']].map(([label,value,unit])=>'<dt>'+label+'</dt><dd>'+amount(value,unit)+'</dd>').join('')+'</dl>'+warnings(m)+'<p class="hub-supply-note">Tỷ lệ tính trực tiếp từ các trường cùng phản hồi; mẫu số bằng 0 hoặc thiếu để trống. FDV giữ số nguồn báo, không thay bằng giá × cung tối đa. Đây là số liệu cung và định giá, chưa phải lượng đang khóa hoặc lịch mở khóa.</p><p class="hub-supply-note">Mốc cập nhật tài sản: '+esc(stamp(m.source.providerUpdatedAt))+'. Nhận: '+esc(stamp(m.source.receivedAt))+'. Nguồn không có mốc cập nhật riêng cho từng trường cung. Giá trị nguồn có thể là ước tính; rê chuột vào số để xem giá trị JSON.</p></section>';
 }
 function sortRows(rows,proofs,order='rank'){
  const known=new Map((proofs||[]).map(p=>[p.sha256,p]));return rows.map((row,index)=>({row,index,m:analyze(row,known.get(row.sourceSha256))})).sort((a,b)=>{const key=order==='fdv'?'fdvToCap':order==='circulating'?'circulatingToMaxPct':null;if(!key)return a.index-b.index;const av=a.m.ratios?.[key],bv=b.m.ratios?.[key];return av==null?(bv==null?a.index-b.index:1):bv==null?-1:(order==='circulating'?av-bv:bv-av)||a.index-b.index;}).map(x=>x.row);
 }
 function renderTable(rows,proofs,{sort='rank'}={}){
  const known=new Map((proofs||[]).map(p=>[p.sha256,p]));
  const controls='<div class="hub-supply-toolbar"><h3>Nguồn cung & định giá</h3><div>'+[['rank','Theo bộ lọc'],['fdv','FDV / Vốn hóa ↓'],['circulating','Lưu hành / Tối đa ↑']].map(([id,label])=>'<button type="button" data-hub-supply-sort="'+id+'" aria-pressed="'+(sort===id)+'"'+(sort===id?' class="selected"':'')+'>'+label+'</button>').join('')+'</div></div>';
  return '<section class="hub-supply-table">'+controls+'<p class="hub-supply-note">Các trường CoinGecko của đúng ID và cùng phản hồi. Tỷ lệ cung không phải tỷ lệ token đang khóa; bấm tài sản để xem số gốc và nguồn.</p><div class="hub-supply-scroll"><table><thead><tr><th>Tài sản</th><th>Vốn hóa · USD</th><th>FDV · USD</th><th>FDV / Vốn hóa</th><th>Lưu hành / Tổng / Tối đa</th><th>Lưu hành / Tối đa</th><th>Mốc cập nhật tài sản</th></tr></thead><tbody>'+rows.map(row=>{const m=analyze(row,known.get(row.sourceSha256));return '<tr'+(row.stale?' class="hub-supply-stale"':'')+'><td><button type="button" data-key="'+esc(row.key)+'"><strong>'+esc(row.base||row.symbol)+'</strong><small>'+esc(row.name||row.id)+'</small></button>'+(m.available?warnings(m):'<small>'+esc(m.reason)+'</small>')+'</td>'+(m.available?'<td>'+amount(m.raw.marketCapUsd)+'</td><td>'+amount(m.raw.fdvUsd)+'</td><td>'+ratio(m.ratios.fdvToCap,'×')+'</td><td class="hub-supply-amounts">'+[['Lưu hành',m.raw.circulatingSupply],['Tổng',m.raw.totalSupply],['Tối đa',m.raw.maxSupply]].map(([label,value])=>'<span><small>'+label+'</small>'+amount(value)+'</span>').join('')+'</td><td>'+ratio(m.ratios.circulatingToMaxPct,'%')+'</td><td>'+esc(stamp(m.source.providerUpdatedAt))+(row.stale?'<small>Bản lưu</small>':'')+'</td>':'<td colspan="6">Chưa có các trường khớp bằng chứng nguồn.</td>')+'</tr>';}).join('')+'</tbody></table></div></section>';
 }
 return Object.freeze({FIELDS,analyze,sortRows,renderPanel,renderTable});
});
