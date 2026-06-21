require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

const SHOPIFY_STORE         = process.env.SHOPIFY_STORE;
const SHOPIFY_CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

let _token = null;
let _tokenExpiresAt = 0;

async function getShopifyToken() {
  if (_token && Date.now() < _tokenExpiresAt - 60_000) return _token;
  const shop = SHOPIFY_STORE.replace('.myshopify.com', '');
  const response = await fetch(
    `https://${shop}.myshopify.com/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'client_credentials',
        client_id:     SHOPIFY_CLIENT_ID,
        client_secret: SHOPIFY_CLIENT_SECRET,
      }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token Shopify falhou (${response.status}): ${text}`);
  }
  const { access_token, expires_in } = await response.json();
  _token = access_token;
  _tokenExpiresAt = Date.now() + expires_in * 1000;
  return _token;
}

async function shopifyGQL(query) {
  const token = await getShopifyToken();
  const r = await axios.post(
    `https://${SHOPIFY_STORE}/admin/api/2026-04/graphql.json`,
    { query },
    { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
  );
  if (r.data.errors) throw new Error(JSON.stringify(r.data.errors));
  return r.data.data;
}

function getMetaCatalogImage(product) {
  const images = product.images?.edges?.map(e => e.node) || [];
  const meta = images.find(img => img.altText === 'meta-catalog');
  return meta ? meta.url : null;
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchCatalogProducts() {
  const products = [];
  let cursor = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const data = await shopifyGQL(`{
      products(first: 50, query: "status:active"${afterClause}) {
        edges {
          node {
            handle
            title
            onlineStoreUrl
            images(first: 10) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  price
                  availableForSale
                  title
                }
              }
            }
          }
          cursor
        }
        pageInfo {
          hasNextPage
        }
      }
    }`);

    const edges = data.products.edges;
    hasNextPage = data.products.pageInfo.hasNextPage;
    if (edges.length > 0) cursor = edges[edges.length - 1].cursor;

    for (const { node } of edges) {
      const imageUrl = getMetaCatalogImage(node);
      if (!imageUrl) continue;

      const productUrl = node.onlineStoreUrl ||
        `https://parabellumstore.com.br/products/${node.handle}`;

      // Preço mínimo entre variantes disponíveis (fallback: primeira variante)
      const variants = node.variants.edges.map(e => e.node);
      const available = variants.filter(v => v.availableForSale);
      const refVariant = available.length > 0 ? available[0] : variants[0];

      products.push({
        id: node.handle,
        imageUrl,
        price: `${Number(refVariant?.price || 0).toFixed(2)} BRL`,
        availability: available.length > 0 ? 'in stock' : 'out of stock',
        title: node.title,
        link: productUrl,
      });
    }
  }

  return products;
}

function generateXML(items) {
  const rows = items.map(item => `    <item>
      <g:id>${item.id}</g:id>
      <g:image_link><![CDATA[${item.imageUrl}]]></g:image_link>
      <g:price>${esc(item.price)}</g:price>
      <g:availability>${item.availability}</g:availability>
      <title>${esc(item.title)}</title>
      <link><![CDATA[${item.link}]]></link>
    </item>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Parabellum Store — Meta Catalog Feed</title>
    <link>https://parabellumstore.com.br</link>
    <description>Feed de imagens 1:1 para Meta Commerce Manager</description>
${rows.join('\n')}
  </channel>
</rss>`;
}

let _cache = null;
let _cacheAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

async function getCachedXML() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  const items = await fetchCatalogProducts();
  _cache = generateXML(items);
  _cacheAt = Date.now();
  console.log(`[${new Date().toISOString()}] Cache atualizado — ${items.length} produtos`);
  return _cache;
}

app.get('/feed', async (req, res) => {
  try {
    const xml = await getCachedXML();
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    console.error('Erro ao gerar feed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/refresh', async (req, res) => {
  try {
    _cache = null;
    const xml = await getCachedXML();
    const count = (xml.match(/<item>/g) || []).length;
    res.json({ ok: true, items: count, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'parabellum-feed',
    status: 'ok',
    cacheAge: _cache ? Math.round((Date.now() - _cacheAt) / 1000) + 's' : 'cold',
    endpoints: ['/feed', '/refresh'],
  });
});

app.listen(PORT, () => {
  console.log(`parabellum-feed rodando na porta ${PORT}`);
});
