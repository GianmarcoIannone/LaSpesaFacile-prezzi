import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import PricesFeed from '../prices-feed.js';
import {collectCarrefour} from './carrefour-prices.mjs';

const day = date => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome'}).format(new Date(date));
const plusDays = (date,n) => day(Date.parse(date)+n*86400000);
const clean = s => String(s || '').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const number = s => {const m=clean(s).match(/\d+(?:[.,]\d+)?/);return m?Number(m[0].replace(',','.')):null;};
const id = s => crypto.createHash('sha256').update(s).digest('hex').slice(0,16);
const normalize = s => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function quantity(text) {
  const m=clean(text).match(/(\d+(?:[.,]\d+)?)\s*(kg|ml|cl|g|l|pz)\b/i);
  return m?{value:Number(m[1].replace(',','.')),unit:m[2].toLowerCase(),count:1}:null;
}
export function eurospinPrices(html, observedAt=day(new Date())) {
  const prices=[];
  const cards=[...html.matchAll(/<li[^>]*class="[^"]*\bproduct-card\b[^"<>]*"[^>]*>([\s\S]*?)<\/li>/g)].map(m=>m[1]);
  const field=(card,cls)=>clean(card.match(new RegExp(`<[^>]+class="[^"]*${cls}[^"<>]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`))?.[1]);
  for(const card of cards){
    const name=field(card,'product-card__title');
    const full=number(field(card,'product-card__price-full'));
    const original=number(field(card,'product-card__price-original'));
    const current=number(field(card,'product-card__price-current'));
    const family=card.includes('Prezzo Family');
    const price=family?full:current;
    if(!name || !price) continue; // Prezzi nascosti dietro login non vengono ricostruiti.
    const url=card.match(/href="(https:\/\/www\.eurospin\.com\/it-it\/prodotti\/[^"\s]+)"/)?.[1];
    const expiry=card.match(/product-card__badge-date-value[^>]*>(\d{2})\/(\d{2})\/(\d{4})/);
    const isOffer=!family && original>price && expiry;
    prices.push({id:'es-'+id(name),name,brand:field(card,'product-card__brand'),chain:'eurospin',chainName:'Eurospin',
      price,originalPrice:isOffer?original:null,priceType:isOffer?'offer':'regular',scope:'national',
      observedAt,validFrom:observedAt,validTo:isOffer?`${expiry[3]}-${expiry[2]}-${expiry[1]}`:plusDays(observedAt,14),
      qty:quantity(field(card,'product-card__meta ')),category:'dispensa',source:'Eurospin',url:url || 'https://www.eurospin.com/it-it/prodotti/',
      note:family?'Senza sconto Family':'Da verificare in negozio'});
  }
  return prices;
}
const chains=[['conad-superstore','Conad Superstore'],['conad-city','Conad City'],['conad','Conad'],['ipercoop','Ipercoop'],['coop','Coop'],['carrefour-express','Carrefour Express'],['carrefour-market','Carrefour Market'],['carrefour-ipermercati','Carrefour'],['lidl','Lidl'],['eurospin','Eurospin'],['penny','Penny'],['todis','Todis'],['md','MD'],['esselunga','Esselunga'],['tigre','Tigre'],['dem','Dem'],['elite','Elite'],['pewex','Pewex']];
export function openPrice(record,today=day(new Date())) {
  const location=record.location,product=record.product;
  if(record.currency!=='EUR' || !location || location.osm_address_country_code!=='IT' || !record.date ||
     record.date<plusDays(today,-30) || record.date>today || record.duplicate_of || !record.price || !record.proof_id) return null;
  const shop=normalize(location.osm_brand || location.osm_name);
  const chain=chains.find(([_,name])=>shop===normalize(name) || shop.startsWith(normalize(name)+' '));
  if(!chain || !record.location_osm_id || !record.location_osm_type) return null;
  const name=record.product_name || product?.product_name;
  if(!name || !product) return null;
  // Sconti di una ricevuta passata non sono promozioni attualmente disponibili.
  const price=record.price_is_discounted?record.price_without_discount:record.price;
  if(!price || !Number.isFinite(price)) return null;
  const q=product.product_quantity,unit=product.product_quantity_unit;
  if(record.price_per) return null; // Prezzi al kg non sono prezzi della confezione.
  return {id:'op-'+record.id,name,brand:product.brands || '',chain:chain[0],chainName:chain[1],price,
    priceType:'indicative',originalPrice:null,observedAt:record.date,validFrom:record.date,validTo:plusDays(record.date,30),
    storeId:record.location_osm_type[0].toLowerCase()+record.location_osm_id,
    address:location.osm_display_name,scope:'store',category:'dispensa',
    qty:q && unit?quantity(`${q} ${unit}`):quantity(product.quantity),source:'Open Prices (ODbL)',
    url:`https://prices.openfoodfacts.org/api/v1/prices/${record.id}`,note:'Prezzo osservato, da verificare in negozio'};
}
async function get(url,json=false,timeout=20000){
  const response=await fetch(url,{headers:{'User-Agent':'LaSpesaFacile/2.13 public-price-collector','Accept':json?'application/json':'text/html'},signal:AbortSignal.timeout(timeout)});
  if(!response.ok) throw new Error(`HTTP ${response.status}`);
  return json?response.json():response.text();
}
export async function collect({flyerFile='offers-data.json',output='prices-data.json'}={}) {
  const today=day(new Date()),sources=[];
  const previous=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8')):null;
  const flyer=JSON.parse(fs.readFileSync(flyerFile,'utf8'));
  let prices=(flyer.offers || []).filter(p=>p.validTo>=today && (!p.validFrom || p.validFrom<=today))
    .map(p=>({...p,priceType:'offer',observedAt:day(flyer.updatedAt),scope:'area',originalPrice:null,discountPct:null,qty:p.qty || quantity(p.rawName || p.name)}));
  sources.push({name:'DoveConviene',status:prices.length?'ok':'empty',count:prices.length,date:flyer.updatedAt});
  try {
    const ordinary=eurospinPrices(await get('https://www.eurospin.com/it-it/prodotti/'),today);
    prices.push(...ordinary);sources.push({name:'Eurospin',status:ordinary.length?'ok':'empty',count:ordinary.length});
  } catch(e) {sources.push({name:'Eurospin',status:'unavailable',message:e.message});}
  try {
    let count=0;
    for(let page=1;page<=5;page++){
      const data=await get(`https://prices.openfoodfacts.org/api/v1/prices?currency=EUR&lat=41.73&lon=13.0&radius_km=75&date__gte=${plusDays(today,-30)}&size=100&page=${page}&order_by=-date`,true);
      const observed=(data.items || []).map(p=>openPrice(p,today)).filter(Boolean);
      prices.push(...observed);count+=observed.length;
      if(page>=data.pages) break;
      await new Promise(r=>setTimeout(r,350));
    }
    sources.push({name:'Open Prices (ODbL)',status:count?'ok':'empty',count});
  } catch(e){sources.push({name:'Open Prices (ODbL)',status:'unavailable',message:e.message});}
  try {
    const ordinary=await collectCarrefour(url=>get(url,false,8000),today);
    prices.push(...ordinary.prices);sources.push({name:'Carrefour online',status:ordinary.prices.length?(ordinary.failures?'partial':'ok'):'unavailable',count:ordinary.prices.length,pages:ordinary.pages,failures:ordinary.failures});
  }catch(e){sources.push({name:'Carrefour online',status:'unavailable',message:e.message});}
  // Mantieni solo osservazioni ancora utilizzabili delle fonti temporaneamente assenti.
  const failed=new Set(sources.filter(s=>s.status==='unavailable' || s.status==='partial').map(s=>s.name));
  prices.push(...(previous?.offers || []).filter(p=>failed.has(p.source) && p.validTo>=today));
  const unique=new Map();
  for(const p of prices){const key=[p.chain,p.storeId || '',normalize(p.name),JSON.stringify(p.qty)].join('|');
    const old=unique.get(key);if(!old || p.observedAt>old.observedAt || p.observedAt===old.observedAt && p.price<old.price) unique.set(key,p);}
  prices=[...unique.values()];
  if(!prices.length) throw new Error('Nessun prezzo utilizzabile: listino precedente preservato');
  const payload={schema:2,updatedAt:new Date().toISOString(),area:{id:'colleferro',name:'Colleferro e dintorni',lat:41.73,lon:13,radiusKm:75},
    source:{name:'DoveConviene · Eurospin · Open Prices · Carrefour online'},sources,chains:flyer.chains || [],offers:prices};
  PricesFeed.validate(payload);
  fs.writeFileSync(output+'.tmp',JSON.stringify(payload,null,2)+'\n');fs.renameSync(output+'.tmp',output);
  console.log(JSON.stringify({prices:prices.length,sources}));return payload;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) collect().catch(e=>{console.error(e.message);process.exitCode=1;});
