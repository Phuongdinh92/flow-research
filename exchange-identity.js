/* Provider-explicit exchange pair -> asset ID links. Never join by symbol alone. */
(function(root,factory){const api=factory();root.FlowExchangeIdentity=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
 'use strict';
 const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),time=t=>Number.isSafeInteger(t)&&t>=946684800000&&t<=Date.now()+300000;
 function derive(sourcePages){
  const candidates=new Map(),conflicts=new Set(),excluded=[];
  for(const page of sourcePages){
   const u=new URL(page.url);if(u.origin!=='https://api.coingecko.com'||u.pathname!=='/api/v3/exchanges/binance/tickers'||u.searchParams.get('order')!=='base_target'||!Number.isInteger(Number(u.searchParams.get('page')))||Number(u.searchParams.get('page'))<1||u.username||u.password||u.hash||page.httpStatus!==200||!hash(page.sha256)||!time(page.receivedAt)||!time(page.startedAt)||page.startedAt>page.receivedAt||typeof page.body!=='string')throw Error('Invalid exchange identity receipt');
   const data=JSON.parse(page.body);if(data.name!=='Binance'||!Array.isArray(data.tickers)||data.tickers.length>100)throw Error('Invalid exchange identity page');
   data.tickers.forEach((t,sourceIndex)=>{
    if(t.target!=='USDT')return;
    const valid=typeof t.base==='string'&&/^[\p{L}\p{N}_.-]{1,80}$/u.test(t.base)&&t.market?.identifier==='binance'&&t.target_coin_id==='tether'&&typeof t.coin_id==='string'&&/^[a-z0-9][a-z0-9-]{0,199}$/.test(t.coin_id);
    let trade;try{trade=new URL(t.trade_url);}catch{}
    if(!valid||!trade||trade.protocol!=='https:'||trade.hostname!=='www.binance.com'||trade.username||trade.password||!trade.pathname.endsWith('/trade/'+t.base+'_USDT')){excluded.push({page:page.url,sourceIndex,base:t.base??null,reason:'unresolved_provider_identity'});return;}
    const key='binance:'+t.base+'USDT',binding={key,sourceId:'binance',instrument:t.base+'USDT',base:t.base,quote:'USDT',coinId:t.coin_id,targetCoinId:'tether',marketIdentifier:'binance',tradeUrl:t.trade_url,sourceTimestamp:t.timestamp??null,sourceUrl:page.url,sourceSha256:page.sha256,sourceReceivedAt:page.receivedAt,sourceIndex};
    const prev=candidates.get(key);if(prev&&prev.coinId!==binding.coinId)conflicts.add(key);else if(!prev)candidates.set(key,binding);
   });
  }
  for(const key of conflicts)candidates.delete(key);
  return {bindings:[...candidates.values()].sort((a,b)=>a.key.localeCompare(b.key)),conflicts:[...conflicts].sort(),excluded};
 }
 async function validateSnapshot(s){
  if(!s||s.schemaVersion!==1||s.kind!=='exchange-asset-identity'||s.provider!=='CoinGecko'||s.exchangeId!=='binance'||!time(s.generatedAt)||!time(s.startedAt)||s.generatedAt<s.startedAt||!Array.isArray(s.sourcePages)||!s.sourcePages.length||!Array.isArray(s.bindings)||typeof s.collectionComplete!=='boolean')throw Error('Invalid exchange asset identity snapshot');
  const pages=new Set();for(const p of s.sourcePages){if(p.receivedAt>s.generatedAt||p.startedAt<s.startedAt||pages.has(p.url))throw Error('Invalid identity collection chronology');pages.add(p.url);const bytes=new TextEncoder().encode(p.body),digest=[...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(digest!==p.sha256)throw Error('Exchange identity source body SHA256 mismatch');}
  const d=derive(s.sourcePages);if(JSON.stringify(d.bindings)!==JSON.stringify(s.bindings)||JSON.stringify(d.conflicts)!==JSON.stringify(s.conflicts)||JSON.stringify(d.excluded)!==JSON.stringify(s.excluded))throw Error('Exchange identity binding differs from raw provider response');
  for(let i=0;i<s.sourcePages.length;i++)if(Number(new URL(s.sourcePages[i].url).searchParams.get('page'))!==i+1)throw Error('Identity pagination gap');
  if(s.collectionComplete&&JSON.parse(s.sourcePages.at(-1).body).tickers.length!==0)throw Error('Missing terminal empty source page');
  return s;
 }
 return Object.freeze({derive,validateSnapshot});
});
