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
  const items = [];
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
            images(first: 50) {
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

      const productNumericId = extractNumericId(node.id);
      const productUrl = node.onlineStoreUrl ||
        `https://parabellumstore.com.br/products/${node.handle}`;
      const description = node.description || node.title;

      for (const { node: variant } of node.variants.edges) {
        items.push({
          id: extractNumericId(variant.id),
          item_group_id: productNumericId,
          handle: node.handle,
          title: node.title,
          description,
          link: productUrl,
          imageUrl,
          price: `${Number(variant.price).toFixed(2)} BRL`,
          availability: 'in stock',
        });
      }
    }
  }

  return items;
}

function generateXML(items) {
  const rows = items.map(item => `    <item>
      <g:id>${item.id}</g:id>
      <g:item_group_id>${item.item_group_id}</g:item_group_id>
      <g:title>${esc(item.title)}</g:title>
      <g:description>${esc(item.description)}</g:description>
      <g:link><![CDATA[${item.link}]]></g:link>
      <g:image_link><![CDATA[${item.imageUrl}]]></g:image_link>
      <g:price>${esc(item.price)}</g:price>
      <g:availability>${item.availability}</g:availability>
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
const CACHE_TTL = 60 * 60 * 1000;

async function getCachedData() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return { xml: _cache, items: _cachedItems };
  const items = await fetchCatalogProducts();
  _cachedItems = items;
  _cache = generateXML(items);
  _cacheAt = Date.now();
  console.log(`[${new Date().toISOString()}] Cache atualizado — ${items.length} variantes de ${new Set(items.map(i => i.item_group_id)).size} produtos`);
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
    const products = new Set(items.map(i => i.item_group_id)).size;
    res.json({ ok: true, variants: items.length, products, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista todos os itens do feed agrupados por produto
// Usar para verificar se os variant IDs casam com o pixel
app.get('/debug', async (req, res) => {
  try {
    const { items } = await getCachedData();
    const grouped = {};
    for (const item of items) {
      if (!grouped[item.item_group_id]) {
        grouped[item.item_group_id] = { title: item.title, handle: item.handle, variants: [] };
      }
      grouped[item.item_group_id].variants.push({
        feed_id: item.id,
        price: item.price,
        availability: item.availability,
      });
    }
    res.json({
      products: Object.keys(grouped).length,
      variants: items.length,
      updatedAt: new Date(_cacheAt).toISOString(),
      note: 'feed_id deve casar com content_ids do pixel. item_group_id é o ID do produto pai.',
      catalog: grouped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// Endpoint de checkout para o Instagram/Facebook Shop (lojinha Meta)
// Meta chama: /shop-checkout?products=VARIANT_ID:QUANTITY&coupon=CODE
// Redireciona para a página do produto → cliente adiciona ao carrinho → Yampi assume
app.get('/shop-checkout', async (req, res) => {
  try {
    const productsParam = req.query.products || '';
    const variantId = productsParam.split(':')[0].split(',')[0].trim();

    if (variantId) {
      const { items } = await getCachedData();
      const item = items.find(i => i.id === variantId);
      if (item) return res.redirect(302, item.link);
    }

    res.redirect(302, 'https://parabellumstore.com.br');
  } catch (err) {
    res.redirect(302, 'https://parabellumstore.com.br');
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'parabellum-feed',
    status: 'ok',
    cacheAge: _cache ? Math.round((Date.now() - _cacheAt) / 1000) + 's' : 'cold',
    endpoints: ['/feed', '/refresh', '/debug', '/publications', '/shop-checkout'],
  });
});

app.listen(PORT, () => {
  console.log(`parabellum-feed rodando na porta ${PORT}`);
});
