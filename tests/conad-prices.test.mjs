import {conadPage,collectConad} from '../tools/conad-prices.mjs';
import {flyersFromHtml} from '../tools/update-offers.mjs';
import assert from 'node:assert/strict';
const today='2026-10-15';
const card=(code,price)=>`<div data-product="${JSON.stringify({code,nome:'Caffè Capsule',basePrice:price,netQuantity:.05,netQuantityUm:'KG',defaultImgSrc:`https://spesaonline.conad.it/assets/products/caffe--${code}/x.jpg`}).replaceAll('"','&#34;')}"></div>`;
const p=conadPage(card('1',2.39)+card('2',0)+card('3',-1),today);assert.equal(p.catalog.length,3);assert.equal(p.catalog[0].price,2.39);assert.equal(p.catalog[1].price,null);assert.ok(p.catalog[1].catalogOnly);assert.ok(p.catalog.every(p=>p.referenceOnly));
const result=await collectConad(async url=>url.includes('page=2')?card('2',0):card('1',2.39)+'<a data-page="2">2</a>',today,{pause:0});assert.equal(result.catalog.length,2);assert.equal(result.prices.length,1);assert.ok(result.complete);
const partial=await collectConad(async url=>{if(url.includes('page=2'))throw Error('offline');return card('1',2)+'<a data-page="2">2</a>'},today,{pause:0});assert.ok(!partial.complete);assert.equal(partial.failures,1);
const events=Array.from({length:5},(_,i)=>({'@type':'SaleEvent',url:'https://www.doveconviene.it/x?flyerId='+i,startDate:'2020-01-01',endDate:'2030-01-01',name:'Volantino '+i}));
assert.equal(flyersFromHtml('<script type="application/ld+json">'+JSON.stringify({itemListElement:events})+'</script>').length,5,'Nessun limite nascosto ai primi tre volantini');
console.log('Conad: catalogo, prezzi mancanti, paginazione, raccolta parziale e tutti i volantini verificati.');

const department=await collectConad(async url=>url.includes('/c/')?card('2',0):card('1',2.39)+'<a href="/c/caffe--0701">Caffè</a><a data-page="181">181</a>',today,{pause:0});
assert.equal(department.pages,2);assert.equal(department.catalog.length,2);assert.ok(department.complete,'Il catalogo viene navigato per reparti invece di richiedere 181 pagine globali');
