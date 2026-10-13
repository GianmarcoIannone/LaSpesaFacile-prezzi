import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const AREA_SLUG = (process.env.OFFERS_CITY || 'roma').trim().toLowerCase();
const AREA_NAME = process.env.OFFERS_CITY_NAME || AREA_SLUG.charAt(0).toUpperCase() + AREA_SLUG.slice(1);
const OUTPUT_PATH = path.resolve(process.env.OFFERS_OUTPUT || 'offers-data.json');
const ALLOW_SMALL_DATASET = process.env.ALLOW_SMALL_DATASET === '1';

const CHAINS = [
  ['conad', 'Conad', 'conad'],
  ['conad-superstore', 'Conad Superstore', 'conad-superstore'],
  ['conad-city', 'Conad City', 'conad-city'],
  ['coop', 'Coop', 'coop'],
  ['ipercoop', 'Ipercoop', 'ipercoop'],
  ['carrefour-express', 'Carrefour Express', 'carrefour-express'],
  ['carrefour-market', 'Carrefour Market', 'carrefour-market'],
  ['carrefour-ipermercati', 'Carrefour Iper', 'carrefour-ipermercati'],
  ['lidl', 'Lidl', 'lidl'],
  ['eurospin', 'Eurospin', 'eurospin'],
  ['penny', 'Penny', 'penny'],
  ['todis', 'Todis', 'todis'],
  ['md', 'MD', 'md'],
  ['esselunga', 'Esselunga', 'esselunga'],
  ['tigre', 'Tigre', 'tigre'],
  ['dem', 'Dem', 'dem'],
  ['elite', 'Elite', 'elite-supermercati'],
  ['pewex', 'Pewex', 'pewex']
].map(([slug, name, dc]) => ({ slug, name, dc }));

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalize(value) {
  return String(value || '')
    .toLocaleLowerCase('it-IT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shortHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
}

function toIsoDate(value, fallback = '') {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return fallback;
  return d.toISOString().slice(0, 10);
}

function numberFrom(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function flattenJsonLd(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach(item => flattenJsonLd(item, out));
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  out.push(value);
  if (Array.isArray(value['@graph'])) flattenJsonLd(value['@graph'], out);
  if (Array.isArray(value.itemListElement)) flattenJsonLd(value.itemListElement, out);
  if (value.item && typeof value.item === 'object') flattenJsonLd(value.item, out);
  return out;
}

function extractJsonLd(html) {
  const nodes = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      flattenJsonLd(JSON.parse(raw), nodes);
    } catch {
      // Una singola struttura JSON-LD rotta non deve bloccare l'intero aggiornamento.
    }
  }
  return nodes;
}

async function fetchText(url, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

function absoluteUrl(value) {
  if (!value) return '';
  try {
    return new URL(value, 'https://www.doveconviene.it').href;
  } catch {
    return '';
  }
}

function typeNames(node) {
  const type = node && node['@type'];
  return Array.isArray(type) ? type.map(String) : type ? [String(type)] : [];
}

function isType(node, expected) {
  return typeNames(node).some(type => type.toLowerCase() === expected.toLowerCase());
}

async function discoverFlyers(chain) {
  const url = `https://www.doveconviene.it/${encodeURIComponent(AREA_SLUG)}/volantino/${encodeURIComponent(chain.dc)}`;
  console.log(`[${chain.name}] ricerca volantini: ${url}`);
  const html = await fetchText(url);
  const nodes = extractJsonLd(html);
  const flyers = [];

  for (const node of nodes) {
    if (!(isType(node, 'SaleEvent') || isType(node, 'OfferCatalog'))) continue;
    const candidates = isType(node, 'OfferCatalog') && Array.isArray(node.itemListElement)
      ? flattenJsonLd(node.itemListElement, [])
      : [node];

    for (const item of candidates) {
      const flyerUrl = absoluteUrl(item.url || item['@id']);
      if (!flyerUrl || !/volantin|flyer|offert/i.test(flyerUrl)) continue;
      const idFromUrl = flyerUrl.match(/[?&]flyerId=(\d+)/i)?.[1];
      flyers.push({
        id: idFromUrl || shortHash(flyerUrl),
        title: String(item.name || node.name || `Volantino ${chain.name}`).trim(),
        validFrom: toIsoDate(item.startDate || node.startDate),
        validTo: toIsoDate(item.endDate || node.endDate),
        url: flyerUrl
      });
    }
  }

  const unique = new Map();
  flyers.forEach(flyer => {
    if (!unique.has(flyer.id)) unique.set(flyer.id, flyer);
  });

  return Array.from(unique.values())
    .sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)))
    .slice(0, 3);
}

function extractOfferObject(productNode) {
  const raw = productNode.offers;
  if (Array.isArray(raw)) return raw.find(Boolean) || null;
  return raw && typeof raw === 'object' ? raw : null;
}

function extractPrice(offer) {
  if (!offer) return null;
  return numberFrom(
    offer.price ??
    offer.lowPrice ??
    offer.highPrice ??
    offer.priceSpecification?.price
  );
}

function extractOriginalPrice(product, offer) {
  const candidates = [
    offer?.highPrice,
    offer?.priceSpecification?.maxPrice,
    product?.price,
    product?.listPrice
  ].map(numberFrom).filter(Number.isFinite);
  return candidates.length ? Math.max(...candidates) : null;
}

function categoryFor(name) {
  const text = normalize(name);
  const groups = [
    ['casa', ['detersiv', 'sgrassator', 'candeggina', 'ammorbident', 'lavatrice', 'lavapiatt', 'carta igienica', 'scottex', 'spugna', 'sacchi']],
    ['persona', ['shampoo', 'balsamo', 'bagnoschiuma', 'sapone', 'dentifric', 'spazzolino', 'deodor', 'rasoio', 'assorbent', 'salvaslip']],
    ['animali', ['crocchette', 'cane', 'gatto', 'lettiera', 'traversine', 'pet food']],
    ['ortofrutta', ['mela', 'pera', 'banana', 'arancia', 'limone', 'pomodor', 'insalat', 'patat', 'carot', 'zucchin', 'verdura', 'frutta']],
    ['latticini', ['latte', 'formagg', 'mozzarell', 'parmigian', 'grana', 'ricotta', 'burro', 'yogurt', 'uova', 'uovo']],
    ['carne', ['pollo', 'tacchin', 'manzo', 'suino', 'maiale', 'vitello', 'salsicci', 'prosciutt', 'salame', 'mortadell', 'wurstel']],
    ['pesce', ['salmone', 'tonno', 'orata', 'spigola', 'merluzzo', 'gamber', 'calamar', 'polpo', 'cozze', 'vongole']],
    ['surgelati', ['surgelat', 'gelato', 'bastoncini', 'pizza surgelata']],
    ['bevande', ['acqua', 'cola', 'pepsi', 'fanta', 'succo', 'aranciata', 'the', 'te ', 'caffe', 'bibita']]
  ];
  for (const [category, terms] of groups) {
    if (terms.some(term => text.includes(normalize(term)))) return category;
  }
  return 'dispensa';
}

function splitBrand(name) {
  const text = String(name || '').trim();
  const dash = text.match(/^(.{2,40}?)\s[-–—]\s(.+)$/);
  if (!dash) return { name: text, brand: null };
  return { brand: dash[1].trim(), name: dash[2].trim() };
}

async function scrapeFlyer(chain, flyer) {
  console.log(`  ${flyer.title}`);
  const html = await fetchText(flyer.url);
  const nodes = extractJsonLd(html);
  const products = [];

  for (const node of nodes) {
    if (!isType(node, 'Product') || !node.name) continue;
    const offerObject = extractOfferObject(node);
    const price = extractPrice(offerObject);
    if (!Number.isFinite(price) || price <= 0) continue;

    const rawName = String(node.name).trim();
    const split = splitBrand(rawName);
    const validFrom = toIsoDate(offerObject?.validFrom || flyer.validFrom);
    const validTo = toIsoDate(offerObject?.priceValidUntil || offerObject?.validThrough || flyer.validTo);
    const originalPrice = extractOriginalPrice(node, offerObject);
    const discountPct = originalPrice && originalPrice > price
      ? Math.round((1 - price / originalPrice) * 1000) / 10
      : null;

    products.push({
      id: shortHash(`${chain.slug}|${flyer.id}|${normalize(rawName)}|${price}`),
      source: 'doveconviene',
      chain: chain.slug,
      chainName: chain.name,
      flyerId: flyer.id,
      flyerTitle: flyer.title,
      validFrom,
      validTo,
      name: split.name,
      brand: split.brand,
      rawName,
      price,
      originalPrice: originalPrice && originalPrice > price ? originalPrice : null,
      discountPct: discountPct && discountPct > 0 ? discountPct : null,
      qty: null,
      unitPrice: null,
      category: categoryFor(rawName),
      url: flyer.url
    });
  }

  return products;
}

function readPrevious() {
  try {
    if (!fs.existsSync(OUTPUT_PATH)) return null;
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function qualityGuard(nextOffers, previous) {
  if (!nextOffers.length) throw new Error('Nessuna offerta estratta: il file esistente non verrà sostituito.');
  const oldCount = Array.isArray(previous?.offers) ? previous.offers.length : 0;
  if (!ALLOW_SMALL_DATASET && oldCount >= 100 && nextOffers.length < Math.max(20, Math.floor(oldCount * 0.25))) {
    throw new Error(`Dataset anomalo: ${nextOffers.length} offerte contro ${oldCount} precedenti. Imposta ALLOW_SMALL_DATASET=1 solo se la riduzione è attesa.`);
  }
}

function writeAtomically(payload) {
  const directory = path.dirname(OUTPUT_PATH);
  fs.mkdirSync(directory, { recursive: true });
  const temp = `${OUTPUT_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, OUTPUT_PATH);
}

async function main() {
  const startedAt = Date.now();
  const allOffers = [];
  const chainsMeta = [];
  const previous = readPrevious();

  console.log(`Aggiornamento offerte per ${AREA_NAME} (${AREA_SLUG})`);

  for (const chain of CHAINS) {
    try {
      const flyers = await discoverFlyers(chain);
      const meta = [];
      for (const flyer of flyers) {
        try {
          const offers = await scrapeFlyer(chain, flyer);
          if (offers.length) {
            allOffers.push(...offers);
            meta.push({
              id: flyer.id,
              title: flyer.title,
              validFrom: flyer.validFrom,
              validTo: flyer.validTo,
              url: flyer.url,
              products: offers.length
            });
          }
        } catch (error) {
          console.warn(`  Volantino ignorato (${flyer.url}): ${error.message}`);
        }
        await sleep(250);
      }
      if (meta.length) chainsMeta.push({ slug: chain.slug, name: chain.name, flyers: meta });
    } catch (error) {
      console.warn(`[${chain.name}] non aggiornato: ${error.message}`);
    }
  }

  const deduped = [];
  const seen = new Set();
  for (const offer of allOffers) {
    const key = `${offer.chain}|${normalize(offer.name)}|${offer.price}|${offer.validTo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(offer);
  }

  deduped.sort((a, b) => a.price - b.price || a.chainName.localeCompare(b.chainName, 'it'));
  qualityGuard(deduped, previous);

  const contentHash = shortHash(JSON.stringify(deduped));
  const payload = {
    schema: 1,
    updatedAt: new Date().toISOString(),
    area: { id: AREA_SLUG, name: AREA_NAME },
    source: {
      name: 'DoveConviene',
      url: `https://www.doveconviene.it/${AREA_SLUG}`
    },
    contentHash,
    chains: chainsMeta,
    offers: deduped
  };

  if (previous?.contentHash === contentHash) {
    console.log(`Prezzi invariati: aggiorno la data della raccolta verificata (${deduped.length} offerte).`);
  }

  writeAtomically(payload);
  console.log(`Salvate ${deduped.length} offerte da ${chainsMeta.length} catene in ${OUTPUT_PATH}.`);
  console.log(`Durata: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch(error => {
  console.error(`Aggiornamento fallito: ${error.message}`);
  process.exitCode = 1;
});
