// Prezzi pubblici del sito: riferimenti per la stima, mai prezzi di una filiale.
const decode=s=>String(s).replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)));
export const roots=['frutta-e-verdura','carne','pesce','salumi-e-formaggi','uova-latte-e-latticini','dolci-e-prima-colazione','pasta-riso-e-farina','condimenti-e-conserve','pane-e-snack-salati','gelati-e-surgelati','acqua-e-analcolici','birra-vino-e-liquori','cura-della-persona','cura-della-casa','animali'];
export function categoryLinks(html){
 return [...new Set([...html.matchAll(/href="(\/spesa-online\/[^"?#]+\/)"/g)].map(m=>decode(m[1])))].filter(p=>roots.includes(p.split('/')[2]));
}
export function nextPageLinks(html){
 const urls=[];
 for(const m of html.matchAll(/<link\b[^>]*>/gi)){
  if(!/rel=["']next["']/i.test(m[0]))continue;
  try{const url=new URL(decode(m[0].match(/href=["']([^"']+)["']/i)?.[1] || ''),'https://www.carrefour.it');
   if(url.origin==='https://www.carrefour.it' && categoryLinks(`<a href="${url.pathname}">`).length && /^\d+$/.test(url.searchParams.get('start') || '') && Number(url.searchParams.get('start'))<=20000)urls.push(url.pathname+url.search);
  }catch{}
 }
 return [...new Set(urls)];
}
export function carrefourPrices(html,observedAt){
 const out=[];
 // Schede singole di riferimento: si leggono solo offerte strutturate in EUR ancora valide.
 for(const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)){
  try{
   const p=JSON.parse(m[1]),o=p.offers;
   if(p['@type']!=='Product' || !o || o.priceCurrency!=='EUR' || !o.priceValidUntil || o.priceValidUntil<observedAt || !/^https:\/\/www\.carrefour\.it\/p\//.test(o.url || ''))continue;
   const price=Number(o.price);if(!Number.isFinite(price)||price<=0||price>10000)continue;
   const size=html.match(/Peso confezione:\s*([\d.,]+)\s*(kg|g|ml|cl|l|pz)\b/i);
   out.push({id:'crf-'+p.sku,name:p.name,brand:p.brand?.name || '',chain:'carrefour-online',chainName:'Carrefour online',price,
    originalPrice:null,priceType:'indicative',referenceOnly:true,scope:'national',observedAt,validFrom:observedAt,
    validTo:[o.priceValidUntil,new Date(Date.parse(observedAt)+14*86400000).toISOString().slice(0,10)].sort()[0],
    qty:size?{value:Number(size[1].replace(',','.')),unit:size[2].toLowerCase(),count:1}:null,
    category:'',source:'Carrefour online',url:o.url,note:'Riferimento online · disponibilità da verificare'});
  }catch{}
 }
 const cards=[...html.matchAll(/data-pid="([^"<>]+)"\s+data-product-json="([^"<>]+)"([\s\S]*?)(?=data-pid="|$)/g)];
 for(const [,pid,raw,body] of cards){
  try{
   const product=JSON.parse(decode(raw));
   const prices=JSON.parse(decode(body.match(/data-option-product-price="([^"<>]+)"/)?.[1] || '{}'));
   // Un listino esposto è preferito al prezzo promozionale, per non propagare offerte scadute.
   const price=prices.list?.value || prices.sales?.value;
   if(prices.sales?.currency!=='EUR' || !Number.isFinite(price) || price<=0 || price>10000 || !product.name || String(product.id)!==pid) continue;
   const path=body.match(/href="(\/p\/[^"<>]+\.html)"/)?.[1];
   if(!path) continue;
   let size=String(product.dimension52 || '');
   const m=size.match(/^(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l|pz)\b/i);
   const qty=m?{value:Number(m[1].replace(',','.')),unit:m[2].toLowerCase(),count:1}:null;
   const expiry=new Date(Date.parse(observedAt)+14*86400000).toISOString().slice(0,10);
   out.push({id:'crf-'+pid,name:product.name,brand:product.brand || '',chain:'carrefour-online',chainName:'Carrefour online',
    price,originalPrice:null,priceType:'indicative',referenceOnly:true,scope:'national',observedAt,validFrom:observedAt,validTo:expiry,
    qty,category:product.category || '',source:'Carrefour online',url:'https://www.carrefour.it'+path,
    note:'Riferimento online · disponibilità da verificare'});
  }catch{/* Una scheda invalida non annulla le altre. */}
 }
 return out;
}
export async function collectCarrefour(get,today){
 const started=Date.now();
 const queue=['/p/carrefour-classic-zucchero-semolato-bianco-1-kg/8012666009879.html','/p/anguria-sfusa-cat.-i-calibro-7%2F17/2030020000000.html','/p/carrefour-classic-te-verde-filtri-25-x-175-g/3560070231515.html',...roots.map(s=>'/spesa-online/'+s+'/')],seen=new Set(),prices=new Map();let failures=0;
 // Tutte le sottocategorie e le pagine pubbliche, con budget esplicito.
 while(queue.length && seen.size<450 && Date.now()-started<480000){
  const path=queue.shift();if(seen.has(path))continue;seen.add(path);
  try{
   const html=await get('https://www.carrefour.it'+path);
   for(const p of carrefourPrices(html,today))prices.set(p.id,p);
   for(const link of [...categoryLinks(html),...nextPageLinks(html)])if(!seen.has(link) && !queue.includes(link))queue.push(link);
  }catch{failures++;}
  if(seen.size%10===0)console.log(`Carrefour: ${seen.size} pagine, ${prices.size} prezzi, ${failures} errori`);
  await new Promise(r=>setTimeout(r,400));
 }
 return {prices:[...prices.values()],pages:seen.size,failures,complete:!queue.length};
}
