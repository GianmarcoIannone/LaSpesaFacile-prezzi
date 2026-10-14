/* Feed pubblico separato dai dati personali, con fallback offline. */
(() => {
  'use strict';
  const URL = 'https://raw.githubusercontent.com/GianmarcoIannone/LaSpesaFacile-prezzi/main/prices-data.json';
  const KEY = 'prices-feed-v1';
  const dateValid = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  function validate(data) {
    if (!data || data.schema !== 2 || !Array.isArray(data.offers) || !data.offers.length ||
        data.offers.length > 30000 || !Number.isFinite(Date.parse(data.updatedAt)) || Date.parse(data.updatedAt)>Date.now()+86400000) throw new Error('Listino non valido');
    for (const p of data.offers) {
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.chain !== 'string' ||
          !Number.isFinite(p.price) || p.price <= 0 || p.price > 10000 ||
          !['offer','regular','indicative'].includes(p.priceType) || !dateValid(p.observedAt) ||
          !dateValid(p.validTo) || p.validFrom && !dateValid(p.validFrom) ||
          !['area','national','store'].includes(p.scope) ||
          p.scope==='store' && !/^[nwr]\d+$/.test(p.storeId || '') ||
          p.originalPrice!=null && (!Number.isFinite(p.originalPrice) || p.originalPrice<=0) ||
          p.qty && (!Number.isFinite(p.qty.value) || p.qty.value<=0 || !['kg','g','gr','ml','cl','l','lt','pz'].includes(p.qty.unit)) ||
          p.unitPrice && (!Number.isFinite(p.unitPrice.value) || !['kg','l','pz'].includes(p.unitPrice.per))) throw new Error('Prezzo non valido');
    }
    if(data.catalog != null){
      if(!Array.isArray(data.catalog) || data.catalog.length>20000) throw new Error('Catalogo non valido');
      for(const p of data.catalog) if(!p || typeof p.id!=='string' || typeof p.name!=='string' || p.name.length>1000 || p.chain!=='conad-online' || p.referenceChain!=='conad' || p.priceType!=='indicative' || p.catalogOnly!==(p.price===null) || p.source!=='Conad online' || !p.referenceOnly || !/^https:\/\/spesaonline\.conad\.it\/p\//.test(p.url || '') || !dateValid(p.observedAt) || !dateValid(p.validTo) || p.price!==null && (!Number.isFinite(p.price) || p.price<=0 || p.price>10000)) throw new Error('Prodotto catalogo non valido');
    }
    return data;
  }
  function available(data, place, today = new Date().toISOString().slice(0,10)) {
    if (!data) return [];
    return data.offers.filter(p => {
      if (p.validTo < today || p.validFrom && p.validFrom > today) return false;
      if (p.scope === 'national') return true;
      if (!place) return false;
      if (p.storeId) return true;
      const area = data.area;
      if (!area || !Number.isFinite(area.lat) || !Number.isFinite(area.lon)) return false;
      const dy = (place.lat-area.lat)*111, dx=(place.lon-area.lon)*111*Math.cos(area.lat*Math.PI/180);
      return Math.hypot(dx,dy) <= (area.radiusKm || 60);
    });
  }
  async function refresh({read,write,fetcher=fetch,online=true,url=URL,timeout=6500}) {
    let cached = null;
    try { const record=await read(KEY); if(record) cached=validate(record); } catch { /* Cache assente o danneggiata. */ }
    if (!online) return {data:cached,status:'offline'};
    const controller=new AbortController();
    let timer;
    try {
      const incoming = await Promise.race([
        (async()=>{
          const response=await fetcher(url,{cache:'no-store',signal:controller.signal});
          if (!response.ok) throw new Error('Listino non raggiungibile');
          return validate(await response.json());
        })(),
        new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Timeout'));},timeout);}),
      ]);
      if (cached && Date.parse(incoming.updatedAt)<Date.parse(cached.updatedAt)) return {data:cached,status:'cached'};
      // Un problema di spazio non impedisce di usare il feed appena scaricato.
      try { await write(KEY,incoming); } catch { /* Cache precedente preservata. */ }
      return {data:incoming,status:'updated'};
    } catch { return {data:cached,status:cached?'cached':'unavailable'}; }
    finally {clearTimeout(timer);}
  }
  const api={validate,available,refresh,URL,KEY};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else window.PricesFeed=api;
})();
