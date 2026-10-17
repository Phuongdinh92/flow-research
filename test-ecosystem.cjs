'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const E = require('./ecosystem.js');
const now = Date.UTC(2026, 9, 16, 8), tests = [];
const coin = (extra = {}) => ({id:'bitcoin',symbol:'btc',name:'Bitcoin',current_price:100,market_cap:1000,total_volume:50,market_cap_rank:1,last_updated:new Date(now-60000).toISOString(),price_change_percentage_1h_in_currency:.5,price_change_percentage_1y_in_currency:80,price_change_percentage_24h:2,price_change_percentage_7d_in_currency:-3,price_change_percentage_30d_in_currency:null,...extra});
function test(name, fn) { tests.push({name,fn}); }
test('catalog identities are provider IDs, not shared ticker symbols', () => {
  const r = E.parseCatalog([{id:'a',symbol:'same',name:'A',platforms:{ethereum:'0x1'}},{id:'b',symbol:'same',name:'B',platforms:{ethereum:'',base:'0x2'}}]);
  assert.equal(r.catalogCount,2); assert.equal(r.contractMappingCount,2);
  assert.throws(()=>E.parseCatalog([{id:'a',symbol:'a',name:'A'},{id:'a',symbol:'a',name:'A'}]));
});
test('market percentages retain percent units and missing values remain null', () => {
  const r = E.parseMarkets([coin()],{now,fetchedAt:now,page:1}).rows[0];
  assert.equal(r.return1hPct,.5);assert.equal(r.return1yPct,80);assert.equal(r.return24hPct,2); assert.equal(r.return7dPct,-3); assert.equal(r.return30dPct,null);
  assert.equal(r.priceUsd,100); assert.equal(r.providerUpdatedAt,now-60000); assert.equal(r.key,'coingecko:bitcoin');
});
test('unpriced, malformed and future data is excluded with explicit errors', () => {
  for (const extra of [{current_price:null},{current_price:0},{current_price:'100'},{total_volume:-1},{last_updated:new Date(now+300001).toISOString()},{last_updated:'bad'}]) {
    const r=E.parseMarkets([coin(extra)],{now,fetchedAt:now}); assert.equal(r.rows.length,0); assert.equal(r.errors.length,1);
  }
  assert.equal(E.parseMarkets([coin({total_volume:0,market_cap:null})],{now,fetchedAt:now}).rows[0].volume24hUsd,0);
});
test('moving rank pages deduplicate by coin ID and preserve newest provider observation', () => {
  const p1=E.parseMarkets([coin()],{now,fetchedAt:now,page:1});
  const p2=E.parseMarkets([coin({current_price:101,last_updated:new Date(now).toISOString()}),coin({id:'bitcoin-copy',name:'Another BTC'})],{now,fetchedAt:now+1000,page:2});
  const merged=E.mergeMarkets([p1,p2]); assert.equal(merged.pricedRows.length,2); assert.equal(merged.duplicateCount,1);
  assert.equal(merged.pricedRows.find(x=>x.id==='bitcoin').priceUsd,101);
});
test('global exchange and asset counts remain distinct from sampled market rows', () => {
  const r=E.parseGlobal({data:{active_cryptocurrencies:22000,markets:1400,total_market_cap:{usd:2e12},total_volume:{usd:1e11},updated_at:now/1000,market_cap_change_percentage_24h_usd:0}});
  assert.equal(r.providerExchangeCount,1400); assert.equal(r.providerActiveAssetCount,22000); assert.equal(r.marketCapChange24hPct,0);
  assert.equal(r.providerUpdatedAt,now);
});
test('stablecoin chart sums USD valuations, excluding raw currency amounts and unreleased supply', () => {
  const raw=[{date:String(now/1000),totalCirculatingUSD:{peggedUSD:100,peggedEUR:120},totalCirculating:{peggedUSD:100,peggedEUR:100},totalUnreleased:{peggedUSD:999999}},
    {date:String(now/1000-86400),totalCirculatingUSD:{peggedUSD:0}}];
  const r=E.parseStablecoinHistory(raw); assert.deepEqual(r,[{time:now-E.DAY,supplyUsd:0},{time:now,supplyUsd:220}]);
  assert.throws(()=>E.parseStablecoinHistory([{date:String(now/1000),totalCirculating:{peggedUSD:100}}]));
  assert.throws(()=>E.parseStablecoinHistory([raw[0],{...raw[0],totalCirculatingUSD:{peggedUSD:221}}]));
});
test('chain joins use exact provider names and distinguish missing data from zero', () => {
  const r=E.mergeChains([{name:'Ethereum',tvl:10},{name:'No stablecoin data',tvl:0}],[{name:'Ethereum',totalCirculatingUSD:{peggedUSD:100}},{name:'Stable only',totalCirculatingUSD:{peggedUSD:0}}]);
  assert.equal(r.length,3); assert.deepEqual(r.find(x=>x.chain==='Stable only'),{chain:'Stable only',tvlUsd:null,stablecoinSupplyUsd:0});
  assert.equal(r.find(x=>x.chain==='No stablecoin data').stablecoinSupplyUsd,null);
});
test('saved broad context validates without requiring a recent timestamp or inventing coverage', () => {
  const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'data/ecosystem-snapshot.json'),'utf8'));
  assert.equal(E.validateSnapshot(raw),raw); assert.ok(raw.global.catalogCount>raw.global.pricedCount); assert.equal(raw.global.pricedCount,raw.global.pricedRows.length);
  assert.ok(raw.stablecoinHistory.length>3000); assert.ok(raw.chains.some(x=>x.tvlUsd===null));
  const bad=structuredClone(raw); bad.global.pricedCount++; assert.throws(()=>E.validateSnapshot(bad));
});
test('snapshot loading fails closed for HTTP errors and malformed content', async () => {
  await assert.rejects(E.loadSnapshot('snapshot.json',async()=>({ok:false,status:404})),/HTTP 404/);
  await assert.rejects(E.loadSnapshot('snapshot.json',async()=>({ok:true,json:async()=>({})})),/Unsupported/);
  const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'data/ecosystem-snapshot.json'),'utf8'));
  const out=await E.loadSnapshot('snapshot.json',async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.method,'GET');return {ok:true,json:async()=>raw};});
  assert.equal(out,raw);
});
test('live market refresh is paced, source-preserving and leaves macro observations dated', async () => {
  const previous=JSON.parse(fs.readFileSync(path.join(__dirname,'data/ecosystem-snapshot.json'),'utf8')),before=JSON.stringify(previous),waits=[],calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push(url); assert.equal(options.credentials,'omit');
    const page=/[?&]page=(\d)/.exec(url);
    const body=page?[coin({id:'coin-'+page[1],market_cap_rank:Number(page[1])})]:{data:{active_cryptocurrencies:23000,markets:1510,total_market_cap:{usd:2e12},total_volume:{usd:1e11},updated_at:now/1000}};
    return {ok:true,text:async()=>JSON.stringify(body)};
  };
  const next=await E.refresh(previous,fetchImpl,{wait:async ms=>waits.push(ms),now:()=>now});
  assert.ok(calls.slice(0,4).every(url=>url.includes('1h%2C24h%2C7d%2C30d%2C1y')));assert.equal(calls.length,5); assert.deepEqual(waits,[8000,8000,8000,8000]);
  assert.ok(calls.every(x=>!x.includes('/coins/list'))); assert.equal(next.global.pricedCount,4);
  assert.equal(next.stablecoinHistory,previous.stablecoinHistory); assert.equal(next.chains,previous.chains);
  assert.equal(next.global.catalogCount,previous.global.catalogCount);
  assert.equal(next.provenance.find(x=>x.id==='defillama_stablecoin_history').fetchedAt,previous.provenance.find(x=>x.id==='defillama_stablecoin_history').fetchedAt);
  assert.equal(JSON.stringify(previous),before); assert.equal(next.provenance.find(x=>x.id==='coingecko_markets_page4').fetchedAt,now);
});
test('live refresh stops immediately on rate limit with no retries or mutations', async () => {
  const previous=JSON.parse(fs.readFileSync(path.join(__dirname,'data/ecosystem-snapshot.json'),'utf8')),before=JSON.stringify(previous);let calls=0;
  await assert.rejects(E.refresh(previous,async()=>{calls++;return {ok:false,status:429};},{wait:async()=>{},now:()=>now}),/429/);
  assert.equal(calls,1); assert.equal(JSON.stringify(previous),before);
  await assert.rejects(E.refresh(previous,async()=>{throw new TypeError('Failed to fetch');},{wait:async()=>{},now:()=>now}),/CORS/);
});
(async()=>{let failed=0;for(const t of tests){try{await t.fn();console.log('PASS '+t.name);}catch(e){failed++;console.error('FAIL '+t.name,e);}}if(failed)process.exitCode=1;else console.log(tests.length+' ecosystem checks passed');})();
