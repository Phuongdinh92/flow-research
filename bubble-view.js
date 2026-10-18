/* Dense price-change bubbles. Geometry describes returns, never wallet activity. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.FlowBubbleView=api;})(globalThis,function(){
'use strict';
const finite=n=>typeof n==='number'&&Number.isFinite(n),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),round=n=>Number(n.toFixed(5));
const modes=['magnitude','equal','turnover'];
function percent(n){const v=n*100;if(!finite(v))return '—';if(v!==0&&Math.abs(v)<.000001)return (v>0?'+':'')+v.toExponential(2)+'%';if(v!==0&&Math.abs(v)<.005)return (v>0?'+':'')+v.toLocaleString('vi-VN',{maximumFractionDigits:6})+'%';return (v>0?'+':'')+v.toLocaleString('vi-VN',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';}
function safeImage(point){
 const url=point.imageUrl||point.image;if(typeof url!=='string'||url.length>800)return null;
 const coinloreId=String(point.instrument||point.id||'');
 if(point.sourceId==='coinlore'&&point.imageIdentityVerified===true&&point.imageSource?.id===coinloreId&&point.imageSource?.returnedId===coinloreId&&point.imageSource?.returnedLogoUrl===url&&/^\d+$/.test(coinloreId)&&/^https:\/\/c2\.coinlore\.com\/img\/(?:25x25|50x50|90x90)\/[a-z0-9][a-z0-9_-]*\.png$/.test(url))return url;
 if(point.sourceId!=='coingecko')return null;
 if(/^https:\/\/(?:coin-images\.coingecko\.com|assets\.coingecko\.com)\/coins\/images\/\d+\/(?:thumb|small|large)\/[a-zA-Z0-9_().%~-]+\.(?:png|jpe?g|webp|svg)(?:\?\d+)?$/.test(url))return url;
 const id=String(point.instrument||point.id||'');if(/^[a-z0-9][a-z0-9_-]{0,120}$/.test(id)&&new RegExp('^assets/token-icons/coingecko/'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\.(png|webp)$').test(url))return url;
 return null;
}
function valid(point){return point&&typeof point.key==='string'&&typeof point.base==='string'&&typeof point.sourceId==='string'&&/^[a-z0-9_-]{1,40}$/.test(point.sourceId)&&finite(point.x)&&finite(point.y)&&point.y>=0;}
function weight(point,sizeBy,maxVolume){return sizeBy==='equal'?1:sizeBy==='turnover'?Math.exp((Math.log(point.y)-Math.log(maxVolume))/2):Math.sqrt(1+Math.min(50,Math.abs(point.x)*100));}
function layout(points,{width=1200,sizeBy='magnitude',maxItems=150}={}){
 if(!Array.isArray(points)||points.some(p=>!valid(p))||!modes.includes(sizeBy))throw Error('Dữ liệu bong bóng không hợp lệ');if(sizeBy==='turnover'&&points.some(p=>p.y===0))throw Error('Diện tích volume cần giá trị giao dịch dương');
 const limit=finite(maxItems)?Math.max(1,Math.min(200,Math.floor(maxItems))):150,selected=[...points].sort((a,b)=>b.y-a.y||a.key.localeCompare(b.key)).slice(0,limit),w=finite(width)?Math.max(240,Math.min(1800,width)):1200;
 const h=w<600?Math.max(480,Math.min(1150,selected.length*6)):Math.max(490,Math.min(760,w*.49)),margin=14,aspect=(w-2*margin)/(h-2*margin);
 if(!selected.length)return {width:w,height:h,circles:[],limit};
 const maxVolume=Math.max(...selected.map(p=>p.y)),ordered=selected.map(p=>({point:p,r:weight(p,sizeBy,maxVolume)})).sort((a,b)=>b.r-a.r||b.point.y-a.point.y||a.point.key.localeCompare(b.point.key)),maxR=ordered[0].r,cell=Math.max(maxR,1)*2,gap=.12,grid=new Map(),packed=[];
 let bounds=null;
 const key=(x,y)=>Math.floor(x/cell)+':'+Math.floor(y/cell);
 function nearby(x,y,r){const found=[];for(let gx=Math.floor((x-r-maxR-gap)/cell);gx<=Math.floor((x+r+maxR+gap)/cell);gx++)for(let gy=Math.floor((y-r-maxR-gap)/cell);gy<=Math.floor((y+r+maxR+gap)/cell);gy++){const bucket=grid.get(gx+':'+gy);if(bucket)found.push(...bucket);}return found;}
 function clear(x,y,r){for(let gx=Math.floor((x-r-maxR-gap)/cell);gx<=Math.floor((x+r+maxR+gap)/cell);gx++)for(let gy=Math.floor((y-r-maxR-gap)/cell);gy<=Math.floor((y+r+maxR+gap)/cell);gy++){const bucket=grid.get(gx+':'+gy);if(!bucket)continue;for(const c of bucket){const distance=r+c.r+gap;if((x-c.x)**2+(y-c.y)**2<distance*distance-1e-10)return false;}}return true;}
 const angles=Array.from({length:12},(_,i)=>[Math.cos(i*Math.PI/6),Math.sin(i*Math.PI/6)]);
 for(const item of ordered){
  const {point,r}=item;let best=null;
  function consider(x,y){if(!finite(x)||!finite(y))return;const left=bounds?Math.min(bounds.left,x-r):x-r,right=bounds?Math.max(bounds.right,x+r):x+r,top=bounds?Math.min(bounds.top,y-r):y-r,bottom=bounds?Math.max(bounds.bottom,y+r):y+r,extent=Math.max((right-left)/aspect,bottom-top),distance=(x/aspect)**2+y*y;if(best&&(extent>best.extent+1e-9||Math.abs(extent-best.extent)<1e-9&&distance>=best.distance-1e-9))return;if(!clear(x,y,r))return;best={point,x,y,r,left,right,top,bottom,extent,distance,near:[]};}
  if(!packed.length)consider(0,0);
  else for(const c of packed){const d=c.r+r+gap;for(const [cos,sin]of angles)consider(c.x+cos*d,c.y+sin*d);
   // Tangencies fill the small gaps between close neighbours without an
   // unbounded force simulation or a frame-rate-dependent layout.
   const neighbours=c.near||[];
   for(const {circle:b}of neighbours){const dx=b.x-c.x,dy=b.y-c.y,distance=Math.hypot(dx,dy),ra=c.r+r+gap,rb=b.r+r+gap;if(!distance||distance>ra+rb||distance<Math.abs(ra-rb))continue;const along=(ra*ra-rb*rb+distance*distance)/(2*distance),perpendicular=Math.sqrt(Math.max(0,ra*ra-along*along)),x=c.x+along*dx/distance,y=c.y+along*dy/distance;consider(x-perpendicular*dy/distance,y+perpendicular*dx/distance);consider(x+perpendicular*dy/distance,y-perpendicular*dx/distance);}
  }
  if(!best)consider(bounds.right+r+gap,0);
  for(const c of packed){const distance=(c.x-best.x)**2+(c.y-best.y)**2;c.near.push({circle:best,distance});c.near.sort((a,b)=>a.distance-b.distance);c.near.length=Math.min(c.near.length,3);best.near.push({circle:c,distance});}best.near.sort((a,b)=>a.distance-b.distance);best.near.length=Math.min(best.near.length,3);packed.push(best);bounds=best;const bucketKey=key(best.x,best.y);if(!grid.has(bucketKey))grid.set(bucketKey,[]);grid.get(bucketKey).push(best);
 }
 const factor=Math.min((w-2*margin)/(bounds.right-bounds.left),(h-2*margin)/(bounds.bottom-bounds.top)),offsetX=(w-(bounds.right-bounds.left)*factor)/2-bounds.left*factor,offsetY=(h-(bounds.bottom-bounds.top)*factor)/2-bounds.top*factor;
 return {width:w,height:h,limit,circles:packed.map(c=>({point:c.point,x:offsetX+c.x*factor,y:offsetY+c.y*factor,r:c.r*factor}))};
}
function title(point,windowLabel){const source=point.sourceName||point.sourceId,quote=point.quote||'USDT';return (point.stale?'QUAN SÁT CŨ · ':'')+(point.y===0?'VOLUME 24H = 0 · CHƯA XÁC NHẬN HOẠT ĐỘNG · ':'')+point.base+' · '+source+' · '+(point.instrument||'')+'\nGiá '+(point.windowLabel||windowLabel)+': '+percent(point.x)+' (tỷ lệ gốc '+point.x+')\n'+(finite(point.last)?'Giá: '+point.last+' '+quote+'\n':'')+(point.volumeLabel||'GD 24H')+': '+point.y+' '+quote+(finite(point.asOf)?'\nThời điểm nguồn: '+new Date(point.asOf).toISOString():'')+(point.windowKind?'\nKhoảng giá: '+new Date(point.openTime).toISOString()+' → '+new Date(point.closeTime).toISOString()+(point.windowKind==='closed_daily'?' · NẾN UTC ĐÃ ĐÓNG':' · LUÂN PHIÊN')+'\nMốc volume: '+new Date(point.volumeAsOf).toISOString():'')+(finite(point.receivedAt)?'\nLần nhận phản hồi nguồn: '+new Date(point.receivedAt).toISOString():'')+(point.returnOpenMismatch?'\nCảnh báo: % nguồn '+percent(point.returnReported??point.return24)+' khác last/giá mở '+percent(point.returnOpenImplied??point.openImpliedReturn24)+'; chưa đối soát.':'');}
function hash(value){let result=2166136261;for(const char of value){result^=char.charCodeAt(0);result=Math.imul(result,16777619);}return (result>>>0).toString(36);}
function bubble(points,options={}){
 const sizeBy=options.sizeBy||'magnitude',windowLabel=options.windowLabel||'24H';let geometry;try{geometry=layout(points,{...options,sizeBy});}catch{return '<p class="chart-empty">Dữ liệu bong bóng không hợp lệ; chưa vẽ tài sản.</p>';}
 const {width:w,height:h,circles}=geometry;if(!circles.length)return '<p class="chart-empty">Không có tài sản đủ dữ liệu trong bộ lọc.</p>';
 const id='bubble-'+hash(circles.map(c=>c.point.key).join('|')+w+sizeBy+windowLabel),leader=circles.reduce((a,b)=>Math.abs(b.point.x)>Math.abs(a.point.x)?b:a,circles[0]);
 const sizing=sizeBy==='magnitude'?'Diện tích tỷ lệ 1 + trị tuyệt đối biến động giá (%); phần biến động chặn ở 50%. Mức nền 1 giúp đọc mã đi ngang.':sizeBy==='turnover'?'Diện tích tỷ lệ volume 24H của các tài sản trong trang; không có mức sàn kích thước.':'Các vòng tròn bằng nhau; diện tích không biểu thị volume, vốn hóa hoặc biến động.';
 let svg='<svg class="chart-svg bubble-stage" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" width="100%" role="img" aria-label="Bản đồ bong bóng giá '+esc(windowLabel)+'"><title>Bong bóng giá '+esc(windowLabel)+'</title><desc>Hiển thị '+circles.length+'/'+points.length+' tài sản trong trang. '+esc(sizing)+' Màu xanh tăng, đỏ giảm. Viền tím đánh dấu biến động tuyệt đối lớn nhất trong trang, không phải cá mập. Vị trí chỉ để xếp hình không chồng lấn. Logo lấy từ đúng tài sản theo nguồn; khi thiếu dùng chữ viết tắt.</desc><defs>';
 for(const [direction,color]of [['up','#082516'],['down','#280a10'],['flat','#14202b']])svg+='<radialGradient id="'+id+'-'+direction+'"><stop offset="0" stop-color="'+color+'" stop-opacity=".3"/><stop offset="1" stop-color="#02090d"/></radialGradient>';
 for(let i=0;i<circles.length;i++){const c=circles[i],r=Math.max(5,Math.min(54,c.r*.33)),x=c.x,y=c.y-c.r*.31;if(c.r>=26&&safeImage(c.point))svg+='<clipPath id="'+id+'-logo-'+i+'"><circle cx="'+round(x)+'" cy="'+round(y)+'" r="'+round(r)+'"/></clipPath>';}
 svg+='</defs><rect class="bubble-backdrop" width="'+w+'" height="'+h+'" rx="10"/>';
 for(let i=0;i<circles.length;i++){
  const c=circles[i],p=c.point,r=c.r,x=c.x,y=c.y,direction=p.x>0?'up':p.x<0?'down':'flat',isLeader=c===leader&&Math.abs(p.x)>.0001,font=Math.max(8,Math.min(34,r*.25)),returnFont=Math.max(7.5,Math.min(36,r*.25)),maxChars=Math.max(3,Math.floor(r*1.72/(font*.63))),characters=Array.from(p.base),name=characters.length>maxChars?characters.slice(0,maxChars-1).join('')+'…':p.base,fullTitle=title(p,windowLabel);
  svg+='<g class="chart-point bubble-coin bubble-'+direction+(isLeader?' bubble-leader':'')+(p.stale?' bubble-stale':'')+(p.y===0?' bubble-inactive':'')+'" tabindex="0" role="button" data-key="'+esc(p.key)+'" aria-label="'+esc(fullTitle)+'"><title>'+esc(fullTitle)+'</title><circle class="bubble-halo" cx="'+round(x)+'" cy="'+round(y)+'" r="'+round(r+.8)+'"/><circle class="chart-bubble" cx="'+round(x)+'" cy="'+round(y)+'" r="'+round(r)+'" fill="url(#'+id+'-'+direction+')"/>';
  if(r>=26){const logoR=Math.max(5,Math.min(54,r*.33)),logoY=y-r*.31,initials=Array.from(p.base).slice(0,2).join(''),image=safeImage(p),hue=parseInt(hash(p.key),36)%360;svg+='<circle class="bubble-monogram-disc" cx="'+round(x)+'" cy="'+round(logoY)+'" r="'+round(logoR)+'" fill="hsl('+hue+' 47% 26%)"/><text class="bubble-monogram bubble-font-'+Math.round(logoR*.85)+'" x="'+round(x)+'" y="'+round(logoY+logoR*.34)+'" text-anchor="middle" font-size="'+round(logoR*.85)+'">'+esc(initials)+'</text>';
   if(image)svg+='<image class="bubble-logo" href="'+esc(image)+'" x="'+round(x-logoR)+'" y="'+round(logoY-logoR)+'" width="'+round(logoR*2)+'" height="'+round(logoR*2)+'" clip-path="url(#'+id+'-logo-'+i+')" preserveAspectRatio="xMidYMid slice" referrerpolicy="no-referrer"/>';
  }
  if(r>=15){const nameY=r>=26?y+r*.3:y-1,returnY=r>=26?y+r*.63:y+Math.min(12,r*.62);svg+='<text class="bubble-ticker bubble-font-'+Math.round(font)+'" x="'+round(x)+'" y="'+round(nameY)+'" text-anchor="middle" font-size="'+round(font)+'">'+esc(name)+'</text><text class="bubble-return bubble-font-'+Math.round(returnFont)+'" x="'+round(x)+'" y="'+round(returnY)+'" text-anchor="middle" font-size="'+round(returnFont)+'">'+esc(percent(p.x))+'</text>';}
  else svg+='<text class="bubble-tiny-label bubble-font-'+Math.round(Math.max(5,Math.min(8,r*.65)))+'" x="'+round(x)+'" y="'+round(y+2.8)+'" text-anchor="middle" font-size="'+round(Math.max(5,Math.min(8,r*.65)))+'">'+esc(Array.from(p.base).slice(0,3).join(''))+'</text>';
  svg+='</g>';
 }
 return svg+'</svg>';
}
const bound=new WeakSet();
function bind(container){if(!container||typeof document==='undefined')return;if(!container.querySelector('.bubble-inspect')){const note=document.createElement('p');note.className='bubble-inspect';note.setAttribute('role','status');note.textContent='Trỏ hoặc dùng Tab để xem giá, nguồn và thời điểm của từng tài sản.';container.appendChild(note);}if(bound.has(container))return;bound.add(container);container.addEventListener('error',e=>{if(e.target?.matches?.('image.bubble-logo'))e.target.remove();},true);for(const event of ['pointerover','focusin'])container.addEventListener(event,e=>{const node=e.target.closest?.('.bubble-coin[data-key]');if(!node||!container.contains(node))return;const target=container.querySelector('.bubble-inspect');if(target)target.textContent=node.getAttribute('aria-label').replace(/\n/g,' · ');});}
return Object.freeze({bubble,layout,safeImage,percent,bind});
});
