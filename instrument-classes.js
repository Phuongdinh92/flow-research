/* Explicit source-verified instrument classes. Never infer a class from a ticker suffix. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.FlowInstrumentClasses=api;})(globalThis,function(){
 'use strict';
 const STOCK_SOURCE='https://www.binance.com/vi/support/announcement/detail/4fea39f8b6e54e1b88e388fc90ce323e';
 const stocks=new Set('AAOIB AAPLB ALABB AMATB AMDB AMZNB ARMB ASMLB ASTSB AVGOB AXTIB BABAB BEB BMNRB CBRSB COHRB COINB CRCLB CRDOB CRWVB DELLB DJTB DRAMB EWYB FLNCB GLWB GMEB GOOGLB GSB HOODB IBMB INTCB INTWB IRENB KORUB LITEB METAB MRVLB MSFTB MSTRB MUB MUUB MVLLB NBISB NFLXB NOKB NVDAB ORCLB PLTRB PYPLB QCOMB QNTB QQQB RKLBB SKHYB SMCIB SMHB SNDKB SNXXB SOXLB SOXSB SPCXB SPYB TQQQB TSLAB TSMB USARB WDCB'.split(' '));
 const stable={XUSD:'https://www.binance.com/en/support/announcement/detail/65af5039eae04563b47e424b9cae77ed',USDC:'https://research.binance.com/static/pdf/industry-map-sep23.pdf',FDUSD:'https://research.binance.com/static/pdf/emerging-stablecoins-latest-developments-.pdf',USDE:'https://www.binance.com/en/square/post/29450657023033'};
 function classify(sourceId,instrument){
  if(sourceId!=='binance'||typeof instrument!=='string'||!instrument.endsWith('USDT'))return {kind:'unclassified',excludedByDefault:false,sourceUrl:null};
  const base=instrument.slice(0,-4);
  if(stocks.has(base))return {kind:'tokenized_security',label:'bStocks · chứng khoán token hóa',excludedByDefault:true,sourceUrl:STOCK_SOURCE};
  if(Object.hasOwn(stable,base))return {kind:'stablecoin',label:'Stablecoin / tài sản neo USD',excludedByDefault:true,sourceUrl:stable[base]};
  if(base==='EUR')return {kind:'fiat',label:'Tiền pháp định EUR',excludedByDefault:true,sourceUrl:'https://www.binance.com/en/support/announcement/detail/f7c6bd7931db40aa83931556b5a43565'};
  return {kind:'unclassified',label:'Chưa phân loại đầy đủ',excludedByDefault:false,sourceUrl:null};
 }
 return Object.freeze({classify,stockSource:STOCK_SOURCE});
});
