require('dotenv').config();
const axios = require('axios');

async function getToken() {
  const shop = process.env.SHOPIFY_STORE.replace('.myshopify.com', '');
  const r = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  return (await r.json()).access_token;
}

async function gql(token, query) {
  const r = await axios.post(
    `https://${process.env.SHOPIFY_STORE}/admin/api/2026-04/graphql.json`,
    { query },
    { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
  );
  if (r.data.errors) throw new Error(JSON.stringify(r.data.errors));
  return r.data.data;
}

async function main() {
  const token = await getToken();

  let all = [];
  let cursor = null;
  let hasNext = true;

  while (hasNext) {
    const after = cursor ? `, after: "${cursor}"` : '';
    const data = await gql(token, `{
      products(first: 50, query: "status:active"${after}) {
        edges {
          cursor
          node {
            id handle title
            variants(first: 100) {
              edges { node { availableForSale } }
            }
            images(first: 10) {
              edges { node { altText } }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }`);
    const edges = data.products.edges;
    hasNext = data.products.pageInfo.hasNextPage;
    if (edges.length) cursor = edges[edges.length - 1].cursor;
    all.push(...edges.map(e => e.node));
  }

  const hasMeta  = p => p.images.edges.some(e => e.node.altText === 'meta-catalog');
  const allOOS   = p => p.variants.edges.every(e => !e.node.availableForSale);
  const someAvail = p => p.variants.edges.some(e => e.node.availableForSale);

  const withMeta    = all.filter(hasMeta);
  const withoutMeta = all.filter(p => !hasMeta(p));
  const metaAllOOS  = withMeta.filter(allOOS);
  const metaInStock = withMeta.filter(someAvail);

  console.log('\n=== VISÃO GERAL ===');
  console.log(`Produtos ativos no Shopify:       ${all.length}`);
  console.log(`Com imagem meta-catalog:           ${withMeta.length}`);
  console.log(`  → ao menos 1 variante em estoque: ${metaInStock.length}  ← entram no feed com "in stock"`);
  console.log(`  → TODAS variantes fora de estoque: ${metaAllOOS.length}  ← entram no feed mas "out of stock"`);
  console.log(`Sem imagem meta-catalog:           ${withoutMeta.length}  ← fora do feed`);

  if (metaAllOOS.length > 0) {
    console.log('\n⚠  Com meta-catalog mas 100% fora de estoque (Meta pode ocultar):');
    metaAllOOS.forEach(p => console.log(`   - ${p.handle}  |  ${p.title}`));
  }

  if (withoutMeta.length > 0) {
    console.log('\n❌ Ativos SEM meta-catalog (fora do feed completamente):');
    withoutMeta.forEach(p => console.log(`   - ${p.handle}  |  ${p.title}`));
  }

  console.log('');
}

main().catch(err => { console.error('Erro:', err.message); process.exit(1); });
