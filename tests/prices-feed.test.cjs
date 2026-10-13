const assert=require('node:assert/strict');
const Feed=require('../prices-feed.js');
const payload={schema:2,updatedAt:'2026-10-13T12:00:00Z',area:{lat:41.73,lon:13,radiusKm:75},offers:[
 {id:'1',name:'Latte',chain:'conad',price:1.2,priceType:'regular',observedAt:'2026-10-13',validTo:'2026-10-25',scope:'area'},
]};
(async()=>{
 assert.equal(Feed.validate(payload),payload);
 assert.throws(()=>Feed.validate({...payload,offers:[{...payload.offers[0],price:-1}]}));
 assert.throws(()=>Feed.validate({...payload,offers:[{...payload.offers[0],validTo:'2026-02-31'}]}));
 assert.throws(()=>Feed.validate({...payload,offers:[{...payload.offers[0],originalPrice:'2.00'}]}));
 assert.equal(Feed.available(payload,{lat:41.73,lon:13},'2026-10-13').length,1);
 assert.equal(Feed.available(payload,{lat:45,lon:9},'2026-10-13').length,0);
 assert.equal(Feed.available(payload,null,'2026-11-01').length,0);
 let calls=0,written=null;
 const args={read:async()=>payload,write:async(k,v)=>written=v,fetcher:async()=>{calls++;return {ok:true,json:async()=>payload};}};
 let r=await Feed.refresh({...args,online:false});assert.equal(r.status,'offline');assert.equal(calls,0);
 r=await Feed.refresh(args);assert.equal(r.status,'updated');assert.equal(written,payload);
 r=await Feed.refresh({...args,fetcher:async()=>{throw Error('offline');}});assert.equal(r.data,payload);assert.equal(r.status,'cached');
 r=await Feed.refresh({...args,fetcher:async()=>({ok:true,json:async()=>({schema:3})})});assert.equal(r.status,'cached');
 r=await Feed.refresh({...args,fetcher:async()=>new Promise(()=>{}),timeout:15});assert.equal(r.status,'cached');
 r=await Feed.refresh({...args,fetcher:async()=>({ok:true,json:async()=>({...payload,updatedAt:'2026-10-01'})})});assert.equal(r.status,'cached');
 r=await Feed.refresh({...args,write:async()=>{throw Error('quota');}});assert.equal(r.status,'updated');
 console.log('Feed prezzi: offline senza rete, cache, timeout, dati invalidi, downgrade e limiti geografici verificati.');
})().catch(e=>{console.error(e);process.exitCode=1;});
