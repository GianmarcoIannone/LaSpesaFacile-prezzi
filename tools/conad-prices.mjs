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
export async function collectConad(get,today,{maxPages=500,maxMs=1500000,pause=2500,resume=null,previousCatalog=null}={}){
 const start=Date.now(),seen=new Map();let failures=0,pages=0,expectedPages=1;
 const errors=[];
 const firstHtml=await get('https://spesaonline.conad.it/tutti-i-prodotti');
 const first=conadPage(firstHtml,today);
 if(!first.catalog.length)throw new Error('Catalogo Conad pubblico non disponibile');
 first.catalog.forEach(p=>seen.set(p.id,p));pages++;
 // Navigazione per reparti: l'elenco generale non restituisce tutte le pagine dichiarate.
 const categories=[...new Set([...firstHtml.matchAll(/href="(\/c\/[^"?]+--\d{4})"/g)].map(m=>decode(m[1])))];
 const resumable=Array.isArray(resume) && resume.length && resume.every(t=>/^\/c\/[^?]+--\d{4}$/.test(t.path) && Number.isInteger(t.page) && t.page>0 && t.page<=50);
 if(resumable) for(const p of previousCatalog || [])if(p.validTo>=today && !seen.has(p.id))seen.set(p.id,p);
 const queue=resumable?[...resume]:categories.length?categories.map(path=>({path,page:1})) : Array.from({length:first.pages-1},(_,i)=>({path:'/tutti-i-prodotti',page:i+2}));
 const pending=[];let rateLimits=0;
 expectedPages+=queue.length;
 while(queue.length && pages<maxPages && Date.now()-start<maxMs){
  const task=queue.shift();
  await new Promise(r=>setTimeout(r,pause));
  try{
   const result=conadPage(await get('https://spesaonline.conad.it'+task.path+(task.page>1?'?page='+task.page:'')),today);
   if(!result.catalog.length){pending.push(task);failures++;if(errors.length<10)errors.push({path:task.path,page:task.page,message:'Pagina senza prodotti'});}
   result.catalog.forEach(p=>seen.set(p.id,p));
   if(categories.length && task.page===1){for(let page=2;page<=result.pages;page++)queue.push({path:task.path,page});expectedPages+=result.pages-1;}
  }catch(e){failures++;if(errors.length<10)errors.push({path:task.path,page:task.page,message:e.message});
   if(e.status===429){queue.unshift(task);rateLimits++;if(rateLimits>=2)break;await new Promise(r=>setTimeout(r,Math.max(e.retryAfter || 60000,60000)));continue;}
   pending.push(task);
  }
  pages++;if(pages%20===0)console.log(`Conad: ${pages}/${expectedPages} pagine, ${seen.size} prodotti, ${failures} errori`);
 }
 const catalog=[...seen.values()];return {catalog,prices:catalog.filter(p=>!p.catalogOnly),pages,expectedPages,expectedProducts:first.total,failures,errors,pending:[...new Map([...pending,...queue].map(t=>[t.path+'?page='+t.page,t])).values()],complete:!queue.length && !pending.length && (!first.total || catalog.length>=first.total)};
}
