// local-upload.js
// Sobe imagens de uma pasta local para o Shopify com alt="meta-catalog".
//
// Uso:
//   node local-upload.js --dry-run
//   node local-upload.js
//   node local-upload.js --handle maldito-cao-de-guerra

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const SHOPIFY_STORE         = process.env.SHOPIFY_STORE;
const SHOPIFY_CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

const IMAGES_DIR = 'D:/Claude Code/Img Catalogo 1 por 1/Claud Adjust Catalog-20260623T013701Z-3-001/Claud Adjust Catalog';
const ALT_TAG    = 'meta-catalog';

const args          = process.argv.slice(2);
const dryRun        = args.includes('--dry-run');
const handleIdx     = args.indexOf('--handle');
const targetHandles = handleIdx >= 0 ? args.slice(handleIdx + 1).filter(a => !a.startsWith('--')) : [];

// Handle = nome do arquivo sem extensão (o sufixo aleatório É parte do handle no Shopify)
// Ex: "maldito-cao-de-guerra-054vl.png" → "maldito-cao-de-guerra-054vl"
function handleFromFilename(filename) {
  return path.basename(filename, path.extname(filename));
}

// ─── Shopify auth ─────────────────────────────────────────────────────────────
let _token = null;
let _tokenExpiresAt = 0;

async function getShopifyToken() {
  if (_token && Date.now() < _tokenExpiresAt - 60_000) return _token;
  const shop = SHOPIFY_STORE.replace('.myshopify.com', '');
  const r = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }),
  });
  if (!r.ok) throw new Error(`Token Shopify falhou (${r.status}): ${await r.text()}`);
  const { access_token, expires_in } = await r.json();
  _token = access_token;
  _tokenExpiresAt = Date.now() + expires_in * 1000;
  return _token;
}

async function shopifyGQL(query, variables = {}) {
  const token = await getShopifyToken();
  const r = await axios.post(
    `https://${SHOPIFY_STORE}/admin/api/2026-04/graphql.json`,
    { query, variables },
    { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
  );
  if (r.data.errors) throw new Error(JSON.stringify(r.data.errors));
  return r.data.data;
}

async function getProduct(handle) {
  const data = await shopifyGQL(`{
    products(first: 1, query: "handle:${handle}") {
      edges {
        node {
          id
          media(first: 20) {
            edges {
              node {
                ... on MediaImage { id alt }
              }
            }
          }
        }
      }
    }
  }`);
  const node = data.products.edges[0]?.node;
  if (!node) return null;
  const existingIds = node.media.edges
    .map(e => e.node)
    .filter(n => n.id && n.alt === ALT_TAG)
    .map(n => n.id);
  return { id: node.id, existingIds };
}

async function removeExistingImages(productId, mediaIds) {
  const data = await shopifyGQL(
    `mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors { field message }
      }
    }`,
    { productId, mediaIds }
  );
  const errors = data.productDeleteMedia.mediaUserErrors;
  if (errors.length > 0) throw new Error(errors.map(e => e.message).join(', '));
}

async function createStagedUpload(filename, mimeType) {
  const data = await shopifyGQL(`
    mutation {
      stagedUploadsCreate(input: [{
        filename: "${filename}"
        mimeType: "${mimeType}"
        httpMethod: POST
        resource: IMAGE
      }]) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }
  `);
  const errors = data.stagedUploadsCreate.userErrors;
  if (errors.length > 0) throw new Error(errors.map(e => e.message).join(', '));
  const target = data.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error('Staged target não retornado');
  return target;
}

async function uploadToStaged(target, imgBuffer, filename, mimeType) {
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', imgBuffer, { filename, contentType: mimeType });
  const r = await axios.post(target.url, form, {
    headers: form.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  if (r.status !== 201) throw new Error(`Upload staged falhou: HTTP ${r.status}`);
}

async function addImageToProduct(productId, resourceUrl) {
  const data = await shopifyGQL(
    `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { id alt } }
        mediaUserErrors { field message }
        product { id }
      }
    }`,
    { productId, media: [{ originalSource: resourceUrl, alt: ALT_TAG, mediaContentType: 'IMAGE' }] }
  );
  const errors = data.productCreateMedia.mediaUserErrors;
  if (errors.length > 0) throw new Error(errors.map(e => e.message).join(', '));
}

function mimeFromExt(ext) {
  if (ext === '.webp') return 'image/webp';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

async function processFile(filePath, index, total) {
  const filename = path.basename(filePath);
  const handle   = handleFromFilename(filename);
  const label    = `[${index}/${total}] ${handle}`;

  const product = await getProduct(handle);
  if (!product) {
    console.log(`⚠  ${label} — não encontrado no Shopify`);
    return 'not_found';
  }

  if (dryRun) {
    const n = product.existingIds.length;
    console.log(`🔍 ${label} — OK${n > 0 ? ` (${n} imagem existente — seria substituída)` : ''}`);
    return 'dry_run';
  }

  if (product.existingIds.length > 0) {
    await removeExistingImages(product.id, product.existingIds);
  }

  const ext      = path.extname(filename).toLowerCase();
  const mimeType = mimeFromExt(ext);
  const imgBuffer = fs.readFileSync(filePath);

  const staged = await createStagedUpload(filename, mimeType);
  await uploadToStaged(staged, imgBuffer, filename, mimeType);
  await addImageToProduct(product.id, staged.resourceUrl);

  console.log(`✅ ${label}`);
  return 'ok';
}

async function main() {
  if (!SHOPIFY_STORE || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    console.error('ERRO: credenciais Shopify não configuradas no .env');
    process.exit(1);
  }

  await getShopifyToken();
  console.log('✅ Shopify autenticado\n');

  const allFiles = fs.readdirSync(IMAGES_DIR)
    .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
    .map(f => path.join(IMAGES_DIR, f));

  let files = allFiles;
  if (targetHandles.length > 0) {
    files = allFiles.filter(f => targetHandles.includes(handleFromFilename(f)));
    if (files.length === 0) {
      console.error(`Nenhuma imagem encontrada para: ${targetHandles.join(', ')}`);
      process.exit(1);
    }
  }

  const mode = dryRun ? 'DRY-RUN' : 'UPLOAD';
  console.log(`Parabellum Meta Catalog — ${mode} — ${files.length} imagem(ns)\n${'─'.repeat(55)}`);

  const counts = { ok: 0, not_found: 0, erro: 0 };
  const erros  = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const status = await processFile(files[i], i + 1, files.length);
      if (status === 'ok' || status === 'dry_run') counts.ok++;
      else counts.not_found++;
    } catch (err) {
      const handle = handleFromFilename(files[i]);
      console.error(`❌ [${i + 1}/${files.length}] ${handle}: ${err.message}`);
      counts.erro++;
      erros.push({ handle, erro: err.message });
    }
    if (!dryRun) await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`✅ Sucesso:         ${counts.ok}`);
  if (counts.not_found) console.log(`⚠  Não encontrado: ${counts.not_found}`);
  if (counts.erro)      console.log(`❌ Erros:          ${counts.erro}`);
  if (erros.length > 0) {
    console.log('\nDetalhes dos erros:');
    erros.forEach(e => console.log(`  ${e.handle}: ${e.erro}`));
  }
  console.log('');
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
