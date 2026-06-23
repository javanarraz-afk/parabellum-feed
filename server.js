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

// Extrai ID numérico de "gid://shopify/Product/7891234567890"
function extractNumericId(gid) {
  return gid.split('/').pop();
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
            id
            handle
            title
            description(truncateAt: 500)
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
                  price
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

      const numericId = extractNumericId(node.id);
      const productUrl = node.onlineStoreUrl ||
        `https://parabellumstore.com.br/products/${node.handle}`;

      const variants = node.variants.edges.map(e => e.node);
      const minPrice = variants.reduce((min, v) => {
        const p = Number(v.price);
        return p < min ? p : min;
      }, Number(variants[0]?.price || 0));

      products.push({
        id: numericId,
        handle: node.handle,
        imageUrl,
        price: `${minPrice.toFixed(2)} BRL`,
        title: node.title,
        description: node.description || node.title,
        link: productUrl,
      });
    }
  }

  return products;
}

function generateXML(items) {
  const rows = items.map(item => `    <item>
      <g:id>${item.id}</g:id>
      <g:title>${esc(item.title)}</g:title>
      <g:description>${esc(item.description)}</g:description>
      <g:link><![CDATA[${item.link}]]></g:link>
      <g:image_link><![CDATA[${item.imageUrl}]]></g:image_link>
      <g:price>${esc(item.price)}</g:price>
      <g:availability>in stock</g:availability>
      <g:condition>new</g:condition>
      <g:brand>Parabellum Store</g:brand>
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
let _cachedItems = [];
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

async function getCachedData() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return { xml: _cache, items: _cachedItems };
  const items = await fetchCatalogProducts();
  _cachedItems = items;
  _cache = generateXML(items);
  _cacheAt = Date.now();
  console.log(`[${new Date().toISOString()}] Cache atualizado — ${items.length} produtos`);
  return { xml: _cache, items };
}

app.get('/feed', async (req, res) => {
  try {
    const { xml } = await getCachedData();
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
    _cachedItems = [];
    const { items } = await getCachedData();
    res.json({ ok: true, items: items.length, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista todos os produtos no feed com ID numérico e handle
// Usar para comparar com o content_ids que o pixel está disparando
app.get('/debug', async (req, res) => {
  try {
    const { items } = await getCachedData();
    res.json({
      count: items.length,
      updatedAt: new Date(_cacheAt).toISOString(),
      note: 'g:id é o ID numérico. Se o pixel disparar outro formato, ajuste aqui.',
      products: items.map(p => ({
        feed_id: p.id,
        handle: p.handle,
        title: p.title,
        has_meta_image: true,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista canais de venda ativos na loja — útil para identificar o ID do canal Facebook
app.get('/publications', async (req, res) => {
  try {
    const data = await shopifyGQL(`{
      publications(first: 20) {
        edges {
          node {
            id
            name
            catalog {
              id
              title
            }
          }
        }
      }
    }`);
    const pubs = data.publications.edges.map(e => ({
      id: e.node.id,
      name: e.node.name,
      catalog: e.node.catalog?.title || null,
    }));
    res.json({ publications: pubs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'parabellum-feed',
    status: 'ok',
    cacheAge: _cache ? Math.round((Date.now() - _cacheAt) / 1000) + 's' : 'cold',
    endpoints: ['/feed', '/refresh', '/debug', '/publications'],
  });
});

app.listen(PORT, () => {
  console.log(`parabellum-feed rodando na porta ${PORT}`);
});
