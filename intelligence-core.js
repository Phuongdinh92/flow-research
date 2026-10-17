/* Transparent completed-candle observations. No wallet identity or proprietary vendor scores. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./signal-core.js'):root.FlowSignals);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.FlowIntelligence=api;
})(typeof globalThis==='object'?globalThis:this,function(Signals){
  'use strict';
  const DAY=86400000, WINDOWS=[1,7,30,90,180];
  const DEFINITIONS=Object.freeze({
    pressureSetup:{label:'Áp lực mua · chưa xác nhận ví',formula:'buyShare7 > 0.52; buyShare30 > 0.50; -30% ≤ return30 ≤ 15%; mean quote7 / mean quote of preceding non-overlapping30 ≥ 1.10',meaning:'Điều kiện mô tả CEX; không xác định ai mua hoặc còn giữ.'},
    volumeAnomaly:{label:'Volume ngày bất thường',formula:'quote hôm nay / mean quote của 30 ngày trước ≥ 2',meaning:'Khối lượng khớp lệnh bất thường; không phải tiền mới vào.'},
    momentumExpansion:{label:'Giá và volume cùng mở rộng',formula:'return7 ≥ 10%; volumeRatio7vsPrior30 ≥ 1.5; buyShare7 > 0.50',meaning:'Động lượng đã xảy ra; không phải dự báo tăng tiếp.'},
    sidewaysBuyPressure:{label:'Áp lực mua trong biên giá hẹp',formula:'pressureSetup = true; max(high30)/min(low30)-1 ≤ 30%',meaning:'Proxy thị trường; không chứng minh tích lũy ví.'},
    possibleSellAbsorption:{label:'Bán chủ động nhiều · giá giữ tương đối',formula:'buyShare7 < 0.48; return7 ≥ -3%; volumeRatio7vsPrior30 ≥ 1.10',meaning:'Quan sát giống hấp thụ bán; cần sổ lệnh, trade tape và tồn kho ví để xác nhận.'},
    overheated:{label:'Đà tăng cao / RSI cao',formula:'Wilder RSI14 ≥ 70; return7 ≥ 15%',meaning:'Mô tả quá khứ; không khẳng định đảo chiều.'}
  });
  const LIMITATIONS=Object.freeze([
    'Các phép đo từ Binance Spot/USDT; không có danh tính tài khoản, tồn kho người mua hoặc bằng chứng cá mập gom.',
    'Danh mục được chọn theo các cặp đang niêm yết tại lúc thu thập; thiếu cặp đã hủy niêm yết và lịch sử thành viên. Có thiên lệch sống sót.',
    'Các ngưỡng là quy tắc nghiên cứu công khai do ứng dụng chọn; chưa được xác thực độc lập hoặc tối ưu trên tập kiểm tra tách biệt.',
    'Không dựng ASI, MEFI, MFI độc quyền, Realized Price, tuổi holder hoặc giá vốn ví từ OHLCV.'
  ]);
  const nullable=(value)=>Number.isFinite(value)?value:null;
  const mean=rows=>rows.length?rows.reduce((s,x)=>s+x,0)/rows.length:null;
  function analyze(history,options={}){
    if(!Signals)throw Error('FlowSignals must load before FlowIntelligence');
    const base=Signals.analyze(history,{now:options.now===undefined?Date.now():options.now,windowDays:365});
    let prev=null,segment=[],avgGain=null,avgLoss=null,events=[],seriesPointPreviousFeatures=null;
    const series=base.seriesFull.map((b,index)=>{
      if(prev&&b.time!==prev.end+1){segment=[];avgGain=null;avgLoss=null;prev=null;seriesPointPreviousFeatures=null;}
      const change=prev?b.close-prev.close:null;
      segment.push(b);const n=segment.length;
      if(n===15){let gains=0,losses=0;for(let j=1;j<n;j++){const d=segment[j].close-segment[j-1].close;gains+=Math.max(d,0);losses+=Math.max(-d,0);}avgGain=gains/14;avgLoss=losses/14;}
      else if(n>15){avgGain=(avgGain*13+Math.max(change,0))/14;avgLoss=(avgLoss*13+Math.max(-change,0))/14;}
      const rsi14=avgGain===null?null:avgLoss===0?(avgGain===0?50:100):100-100/(1+avgGain/avgLoss);
      let volatility30=null,range30=null,maxDrawdown30=null;
      if(n>=30){const rows=segment.slice(-30);range30=Math.max(...rows.map(x=>x.high))/Math.min(...rows.map(x=>x.low))-1;let peak=rows[0].close,dd=0;for(const x of rows){peak=Math.max(peak,x.close);dd=Math.max(dd,1-x.close/peak);}maxDrawdown30=dd;}
      if(n>=31){const rows=segment.slice(-31),returns=rows.slice(1).map((x,j)=>Math.log(x.close/rows[j].close)),m=mean(returns);volatility30=Math.sqrt(returns.reduce((s,x)=>s+(x-m)**2,0)/(returns.length-1))*Math.sqrt(365);}
      const prior=n>=31?segment.slice(-31,-1):null;
      const priorMean=prior&&!prior.some(x=>x.quote===null)?mean(prior.map(x=>x.quote)):null;
      const quoteRatio1vsPrior30=b.quote!==null&&priorMean>0?b.quote/priorMean:null;
      const distanceEma50=b.ema50===null?null:b.close/b.ema50-1,distanceEma200=b.ema200===null?null:b.close/b.ema200-1;
      function predicate(values,test){return values.some(x=>x===null)?null:!!test();}
      const features={
        pressureSetup:b.candidateAtClose,
        volumeAnomaly:predicate([quoteRatio1vsPrior30],()=>quoteRatio1vsPrior30>=2),
        momentumExpansion:predicate([b.return7,b.volumeRatio7vsPrior30,b.buyShare7],()=>b.return7>=.10&&b.volumeRatio7vsPrior30>=1.5&&b.buyShare7>.50),
        sidewaysBuyPressure:predicate([b.candidateAtClose,range30],()=>b.candidateAtClose&&range30<=.30),
        possibleSellAbsorption:predicate([b.buyShare7,b.return7,b.volumeRatio7vsPrior30],()=>b.buyShare7<.48&&b.return7>=-.03&&b.volumeRatio7vsPrior30>=1.1),
        overheated:predicate([rsi14,b.return7],()=>rsi14>=70&&b.return7>=.15)
      };
      const metrics={...b,rsi14,quoteRatio1vsPrior30,range30,maxDrawdown30,volatility30,distanceEma50,distanceEma200};
      const missingInputCount=[b.buyShare7,b.buyShare30,b.volumeRatio7vsPrior30,b.return30,rsi14,volatility30].filter(x=>x===null).length;
      const axes={pressure:{buyShare7:b.buyShare7,buyShare30:b.buyShare30,delta7:null,delta30:null},positioningProxy:{distanceEma50,distanceEma200,range30,return30:b.return30},momentum:{return7:b.return7,return30:b.return30,volumeRatio7vsPrior30:b.volumeRatio7vsPrior30},overheat:{rsi14,distanceEma50,return7:b.return7},risk:{maxDrawdown30,volatility30,missingInputCount}};
      for(const days of [7,30]){const rows=n>=days?segment.slice(-days):null;axes.pressure['delta'+days]=rows&&!rows.some(x=>x.delta===null)?rows.reduce((s,x)=>s+x.delta,0):null;}
      const point={time:b.time,end:b.end,close:b.close,metrics,features,axes};
      for(const signal of Object.keys(DEFINITIONS)){
        const previous=seriesPointPreviousFeatures;
        if(features[signal]===true&&(!previous||previous[signal]!==true))events.push({id:history.key+':'+signal+':'+b.end,key:history.key,signal,signalTime:b.end,availableAt:b.end+1,referenceClose:b.close,index,firstObservable:!previous||previous[signal]===null,inputs:{buyShare7:b.buyShare7,buyShare30:b.buyShare30,return7:b.return7,return30:b.return30,volumeRatio7vsPrior30:b.volumeRatio7vsPrior30,quoteRatio1vsPrior30,range30,rsi14}});
      }
      seriesPointPreviousFeatures=features;prev=b;return point;
    });
    return {key:base.key,base:base.base,instrument:base.instrument,sourceId:base.sourceId,quote:base.quote,latest:series.at(-1),series,events,coverage:base.coverage,asOf:base.asOf,fetchedAt:base.fetchedAt,definitions:DEFINITIONS,limitations:LIMITATIONS,unavailable:{walletIdentity:'Không có danh tính người mua trên dữ liệu CEX.',walletCostBasis:'Cần sổ lot/vị thế và giá giao dịch on-chain.',realizedBands:'Không suy ra từ OHLCV.',holderAge:'Cần lịch sử chuyển/mua và quy tắc phân bổ tuổi.'},methodology:{rsi:'Wilder RSI14; seed first14 changes; flat prices=50; gaps reset.',volatility:'Sample standard deviation of last30 log daily close returns × sqrt365; 31 continuous closes required.',axes:'Five groups of raw observations, not five normalized scores or evidence of wallet ownership.',events:'An onset occurs when a completed-day condition becomes true after false/unknown. Daily true states are available separately in series. Appending future candles cannot alter earlier observations.'}};
  }
  function periodStart(time,period){const d=new Date(time);if(period==='month')return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);if(period==='week'){const day=d.getUTCDay()||7;return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-day+1);}return Math.floor(time/DAY)*DAY;}
  function eventsSummary(events,asOf){
    if(!Number.isFinite(asOf))throw Error('asOf required');
    const cutoff=Math.floor(asOf/DAY)*DAY-1,counts={};
    for(const signal of Object.keys(DEFINITIONS)){const selected=events.filter(e=>e.signal===signal&&e.signalTime<=cutoff);counts[signal]={};for(const days of WINDOWS)counts[signal][days]=selected.filter(e=>e.signalTime>cutoff-days*DAY).length;}
    const aggregate=period=>{const buckets=new Map();for(const e of events){if(e.signalTime>cutoff)continue;const from=periodStart(e.signalTime,period),key=String(from);if(!buckets.has(key))buckets.set(key,{from,to:period==='week'?from+7*DAY-1:Date.UTC(new Date(from).getUTCFullYear(),new Date(from).getUTCMonth()+1,1)-1,counts:{}});const b=buckets.get(key);b.counts[e.signal]=(b.counts[e.signal]||0)+1;}return [...buckets.values()].sort((a,b)=>a.from-b.from).map(b=>({...b,complete:b.to<=cutoff}));};
    return {cutoff,unit:'condition onsets, not trades or unique investors',windows:counts,calendarWeek:aggregate('week'),calendarMonth:aggregate('month')};
  }
  function outcome(bars,index,horizon,options={}){
    if(!Number.isInteger(horizon)||horizon<1)throw Error('Invalid horizon');
    const feeBps=options.feeBps===undefined?10:options.feeBps,slippageBps=options.slippageBps===undefined?10:options.slippageBps;
    if(!Number.isFinite(feeBps)||!Number.isFinite(slippageBps)||feeBps<0||slippageBps<0||feeBps+slippageBps>=10000)throw Error('Invalid trading costs');
    const entry=bars[index+1],exit=bars[index+horizon];
    if(!entry||!exit)return {horizon,status:'pending',reason:'Không đủ ngày tương lai trong bản thu thập',entryTime:entry?.time??null,exitTime:null,grossReturn:null,netReturn:null,maxDrawdown:null,worstLowFromEntry:null};
    const rows=bars.slice(index+1,index+horizon+1);
    if(rows.length!==horizon||entry.time!==bars[index].time+DAY||rows.some((b,j)=>b.time!==entry.time+j*DAY))return {horizon,status:'missing',reason:'Thiếu ngày liên tục trong cửa sổ kết quả',entryTime:entry.time,exitTime:exit.end,grossReturn:null,netReturn:null,maxDrawdown:null,worstLowFromEntry:null};
    let peak=entry.open,drawdown=0;for(const b of rows){drawdown=Math.max(drawdown,1-b.close/peak);peak=Math.max(peak,b.close);}
    const cost=(feeBps+slippageBps)/10000,grossReturn=exit.close/entry.open-1,netReturn=exit.close*(1-cost)/(entry.open*(1+cost))-1;
    return {horizon,status:'complete',entryTime:entry.time,exitTime:exit.end,entryOpen:entry.open,exitClose:exit.close,grossReturn,netReturn,maxDrawdown:drawdown,worstLowFromEntry:Math.min(...rows.map(b=>b.low))/entry.open-1};
  }
  function describe(values){const a=values.filter(Number.isFinite).sort((x,y)=>x-y);return {count:a.length,mean:mean(a),median:a.length?(a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2):null,positiveRate:a.length?a.filter(x=>x>0).length/a.length:null,min:a.length?a[0]:null,max:a.length?a.at(-1):null};}
  function validateStudy(s,options={}){
    const fail=message=>{throw Error('Nghiên cứu sự kiện không hợp lệ: '+message);};
    const integer=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
    const finite=v=>typeof v==='number'&&Number.isFinite(v);
    const sameNumber=(a,b)=>a===b||(finite(a)&&finite(b)&&Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)));
    const assert=(v,m)=>{if(!v)fail(m);};
    const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
    const now=options.now===undefined?Date.now():options.now;
    assert(s&&s.schemaVersion===1&&s.kind==='transparent-market-intelligence','schema/nguồn');
    assert(integer(s.asOf,946684800000)&&integer(s.generatedAt,s.asOf)&&s.generatedAt<=now+60000,'thời gian nguồn');
    assert(integer(s.cutoff,946684800000)&&(s.cutoff+1)%DAY===0&&s.cutoff===Math.floor(s.asOf/DAY)*DAY-1,'ngày UTC chốt');
    assert(s.lastClosedDay===new Date(s.cutoff).toISOString().slice(0,10),'nhãn ngày UTC');
    assert(s.source?.sourceId==='binance'&&s.source.archiveCollectionState==='complete'&&hash(s.source.sha256)&&s.source.codeSha256,'hash dữ liệu / bộ tính / trạng thái thu thập');
    for(const name of ['intelligence-core.js','signal-core.js','instrument-classes.js','collect_intelligence.cjs'])assert(hash(s.source.codeSha256[name]),'thiếu hash '+name);
    if(options.expectedSourceSha256!==undefined)assert(hash(options.expectedSourceSha256)&&s.source.sha256===options.expectedSourceSha256,'gói nghiên cứu không khớp gói nến đang xem');
    if(options.expectedCutoff!==undefined)assert(s.cutoff===options.expectedCutoff,'ngày chốt không khớp gói nến đang xem');
    if(options.expectedCodeSha256)for(const [name,value]of Object.entries(options.expectedCodeSha256))assert(hash(value)&&s.source.codeSha256[name]===value,'bộ tính không khớp '+name);
    assert(JSON.stringify(s.definitions)===JSON.stringify(DEFINITIONS),'ngưỡng mô tả không khớp bộ tính');
    assert(Array.isArray(s.latest)&&Array.isArray(s.eventLedger)&&Array.isArray(s.limitations)&&s.limitations.length>=4,'thiếu dữ liệu/giới hạn');
    const keys=new Map();for(const r of s.latest){assert(typeof r.key==='string'&&r.key==='binance:'+r.instrument&&!keys.has(r.key)&&r.latest?.end<=s.cutoff,'định danh cặp');keys.set(r.key,r);}
    const c=s.coverage;assert(c&&integer(c.archivedInstruments)&&c.archiveExpectedInstruments===c.archivedInstruments&&c.analyzedInstruments===keys.size&&Array.isArray(c.errors)&&c.archivedInstruments===c.analyzedInstruments+c.errors.length,'coverage tổng');
    const included=s.latest.filter(r=>r.classification?.excludedByDefault===false);assert(c.defaultIncludedInstruments===included.length&&c.eventStudyInstruments===included.filter(r=>r.key!=='binance:BTCUSDT').length,'coverage danh mục');
    assert(c.uniqueBeneficialOwnersKnown===0&&c.fullHistoricalUniverse===false,'giới hạn chủ thể / lịch sử thành viên');
    const ids=new Map();let previousTime=0;
    for(const e of s.eventLedger){
      assert(e&&keys.has(e.key)&&DEFINITIONS[e.signal]&&integer(e.signalTime,946684800000)&&e.signalTime<=s.cutoff&&(e.signalTime+1)%DAY===0&&e.signalTime>=previousTime,'thứ tự sự kiện');previousTime=e.signalTime;
      assert(e.id===e.key+':'+e.signal+':'+e.signalTime&&!ids.has(e.id)&&e.availableAt===e.signalTime+1&&integer(e.index)&&finite(e.referenceClose)&&e.referenceClose>0&&typeof e.firstObservable==='boolean','định danh sự kiện');ids.set(e.id,e);
    }
    assert(JSON.stringify(s.eventCounts)===JSON.stringify(eventsSummary(s.eventLedger,s.asOf)),'bộ đếm / lịch sự kiện');
    const study=s.eventStudy,design=study?.design;
    assert(design?.kind==='retrospective_descriptive_event_study'&&design.signal==='pressureSetup'&&JSON.stringify(design.horizons)==='[7,30]'&&Array.isArray(study.events)&&Array.isArray(design.limitations)&&design.limitations.length>=4,'thiết kế nghiên cứu');
    const costs=design.costs;assert(costs&&finite(costs.feeBpsPerSide)&&finite(costs.slippageBpsPerSide)&&costs.feeBpsPerSide>=0&&costs.slippageBpsPerSide>=0&&costs.feeBpsPerSide+costs.slippageBpsPerSide<10000,'chi phí');
    const cost=(costs.feeBpsPerSide+costs.slippageBpsPerSide)/10000,seen=new Set(),lastSelected=new Map();
    for(const e of study.events){
      const original=ids.get(e.id);assert(original&&e.signal==='pressureSetup'&&e.key!=='binance:BTCUSDT'&&!keys.get(e.key).classification.excludedByDefault&&!seen.has(e.id)&&e.firstObservable===false,'chọn sự kiện');seen.add(e.id);
      for(const k of ['key','signal','signalTime','availableAt','referenceClose','index','firstObservable'])assert(e[k]===original[k],'sự kiện không khớp ledger');
      assert(!lastSelected.has(e.key)||e.signalTime-lastSelected.get(e.key)>=30*DAY,'sự kiện chồng lấn');lastSelected.set(e.key,e.signalTime);
      assert(integer(e.baselinePoolCount),'nhóm đối chiếu');
      for(const h of [7,30]){
        const o=e.outcomes?.[h],b=o?.baseline;assert(o&&o.horizon===h&&['complete','pending','missing'].includes(o.status)&&b&&integer(b.count)&&integer(b.unavailableCount)&&b.count+b.unavailableCount===e.baselinePoolCount,'đầu ra / coverage đối chiếu');
        if(o.status==='complete'){
          assert(o.entryTime===e.signalTime+1&&o.exitTime===o.entryTime+h*DAY-1&&finite(o.entryOpen)&&o.entryOpen>0&&finite(o.exitClose)&&o.exitClose>0,'giá / thời điểm mô phỏng');
          assert(sameNumber(o.grossReturn,o.exitClose/o.entryOpen-1)&&sameNumber(o.netReturn,o.exitClose*(1-cost)/(o.entryOpen*(1+cost))-1),'lợi nhuận / chi phí');
          assert(finite(o.maxDrawdown)&&o.maxDrawdown>=0&&o.maxDrawdown<=1&&finite(o.worstLowFromEntry)&&o.worstLowFromEntry>=-1&&o.worstLowFromEntry<=0,'drawdown');
        }else assert(o.grossReturn===null&&o.netReturn===null&&o.maxDrawdown===null&&o.worstLowFromEntry===null,'không được điền 0 cho kết quả thiếu');
        assert(o.btcNetReturn===null||finite(o.btcNetReturn),'BTC');
        assert(sameNumber(o.excessBtc,o.status==='complete'&&o.btcNetReturn!==null?o.netReturn-o.btcNetReturn:null),'chênh BTC');
        if(b.count===0)assert(b.meanNetReturn===null&&b.medianNetReturn===null&&b.positiveRate===null,'nhóm đối chiếu rỗng');else assert(finite(b.meanNetReturn)&&finite(b.medianNetReturn)&&finite(b.positiveRate)&&b.positiveRate>=0&&b.positiveRate<=1,'thống kê nhóm đối chiếu');
        assert(sameNumber(o.excessBaseline,o.status==='complete'&&b.meanNetReturn!==null?o.netReturn-b.meanNetReturn:null),'chênh nhóm đối chiếu');
      }
    }
    for(const h of [7,30]){
      const rows=study.events.map(e=>e.outcomes[h]),complete=rows.filter(o=>o.status==='complete'),summary=study.summary?.[h];assert(summary&&summary.selectedEvents===rows.length&&summary.completedEvents===complete.length&&summary.pendingEvents===rows.filter(o=>o.status==='pending').length&&summary.missingEvents===rows.filter(o=>o.status==='missing').length,'số kết quả');
      for(const [field,read]of Object.entries({netReturn:o=>o.netReturn,grossReturn:o=>o.grossReturn,excessBtc:o=>o.excessBtc,excessBaseline:o=>o.excessBaseline,matchedBaselineMean:o=>o.baseline.meanNetReturn,maxDrawdown:o=>o.maxDrawdown,worstLowFromEntry:o=>o.worstLowFromEntry})){
        const expected=describe(complete.map(read));for(const [k,v]of Object.entries(expected))assert(sameNumber(summary[field]?.[k],v),'thống kê '+h+'D '+field+'.'+k);
      }
      assert(summary.negativeEvents===complete.filter(o=>o.netReturn<0).length&&summary.zeroEvents===complete.filter(o=>o.netReturn===0).length&&summary.positiveEvents===complete.filter(o=>o.netReturn>0).length,'số trường hợp lãi/lỗ');
    }
    return s;
  }
  async function verifyStudy(s,options={}){
    if(!options.expectedSourceSha256||options.expectedCutoff===undefined)throw Error('Cần hash và ngày chốt của gói nến đang xem để đối chiếu nghiên cứu.');
    validateStudy(s,options);
    const fetchImpl=options.fetchImpl||globalThis.fetch,cryptoImpl=options.cryptoImpl||globalThis.crypto;
    if(!cryptoImpl?.subtle||!fetchImpl)throw Error('Không có SHA-256 để kiểm tra bộ tính nghiên cứu.');
    const names=['intelligence-core.js','signal-core.js','instrument-classes.js','collect_intelligence.cjs'];
    const hashes=await Promise.all(names.map(async name=>{
      const r=await fetchImpl('./'+name,{credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(30000)});
      if(!r.ok)throw Error('Không đọc được bộ tính '+name+' HTTP '+r.status);
      const bytes=await r.arrayBuffer(),digest=await cryptoImpl.subtle.digest('SHA-256',bytes),hash=[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(hash!==s.source.codeSha256[name])throw Error('Nghiên cứu dùng bộ tính khác phiên bản: '+name);return [name,hash];
    }));
    return validateStudy(s,{...options,expectedCodeSha256:Object.fromEntries(hashes)});
  }
  return Object.freeze({DAY,WINDOWS,DEFINITIONS,LIMITATIONS,analyze,eventsSummary,outcome,describe,periodStart,validateStudy,verifyStudy});
});
