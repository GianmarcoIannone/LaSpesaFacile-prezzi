// Catalogo ufficiale pubblico: nessun login, nessuna ricostruzione dei prezzi nascosti.
const decode=s=>String(s).replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&apos;/g,"'");
export function conadPage(html,today){
 const catalog=[];
 for(const m of html.matchAll(/data-product="([^"<>]+)"/g))try{
  const p=JSON.parse(decode(m[1]));if(!p.code || !p.nome)continue;
  const slug=(p.defaultImgSrc || '').match(/\/products\/([^/]+)\//)?.[1];if(!slug)continue;
  const price=typeof p.basePrice==='number' && p.basePrice>0 && p.basePrice<=10000?p.basePrice:null;
  const unit=String(p.netQuantityUm || '').toLowerCase();
  const qty=Number(p.netQuantity)>0 && ['kg','g','l','ml','pz'].includes(unit)?{value:Number(p.netQuantity),unit,count:1}:null;
  catalog.push({id:'conad-online-'+p.code,name:p.nome,brand:p.marchio || '',chain:'conad-online',chainName:'Conad online',referenceChain:'conad',
   price,priceType:'indicative',referenceOnly:true,catalogOnly:price===null,scope:'national',qty,
   category:[p.categoriaPrimoLivello,p.categoriaSecondoLivello,p.categoriaTerzoLivello].filter(Boolean).join(' · '),
   observedAt:today,validFrom:today,validTo:new Date(Date.parse(today)+7*86400000).toISOString().slice(0,10),
   source:'Conad online',url:'https://spesaonline.conad.it/p/'+slug,note:price===null?'Prezzo da verificare nel negozio scelto':'Prezzo pubblico online · verifica nel tuo negozio'});
 }catch{}
 const pages=Math.max(1,...[...html.matchAll(/data-page="(\d+)"/g)].map(m=>+m[1]));
 const total=Number(html.match(/class="results"[^>]*>\s*([\d.]+)\s+risultati/)?.[1]?.replaceAll('.','')) || null;
 return {catalog,pages,total};
}
export async function collectConad(get,today,{maxPages=400,maxMs=600000,pause=250}={}){
 const start=Date.now(),seen=new Map();let failures=0,pages=0;
 const first=conadPage(await get('https://spesaonline.conad.it/tutti-i-prodotti'),today);
 if(!first.catalog.length)throw new Error('Catalogo Conad pubblico non disponibile');
 first.catalog.forEach(p=>seen.set(p.id,p));pages++;
 let next=2;
 // Due richieste al massimo; limiti e completezza dichiarati nel feed.
 await Promise.all([0,1].map(async()=>{while(next<=Math.min(first.pages,maxPages) && Date.now()-start<maxMs){const page=next++;try{const result=conadPage(await get('https://spesaonline.conad.it/tutti-i-prodotti?page='+page),today);if(!result.catalog.length)failures++;result.catalog.forEach(p=>seen.set(p.id,p));}catch{failures++;}pages++;if(page%20===0)console.log(`Conad: ${page}/${first.pages} pagine, ${seen.size} prodotti`);await new Promise(r=>setTimeout(r,pause));}}));
 const catalog=[...seen.values()];return {catalog,prices:catalog.filter(p=>!p.catalogOnly),pages,expectedPages:first.pages,expectedProducts:first.total,failures,complete:pages===first.pages && !failures && (!first.total || catalog.length>=first.total)};
}
