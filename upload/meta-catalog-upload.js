// meta-catalog-upload.js
// Sobe imagens da pasta Drive "Claud Adjust Catalog" como imagem adicional
// nos produtos Shopify com alt="meta-catalog".
// A imagem de capa (vitrine) não é tocada.
//
// Uso:
//   node meta-catalog-upload.js --dry-run
//   node meta-catalog-upload.js
//   node meta-catalog-upload.js --handle long-barrel-preta-sehlu
//   node meta-catalog-upload.js --handle handle-1 handle-2

require('dotenv').config();
const { google } = require('googleapis');
const axios = require('axios');
const FormData = require('form-data');

const SHOPIFY_STORE         = process.env.SHOPIFY_STORE;
const SHOPIFY_CLIENT_ID     = process.env.SHOPIFY_CLIENT_ID;
const SHOPIFY_CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const GOOGLE_CLIENT_ID      = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET  = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN  = process.env.GOOGLE_REFRESH_TOKEN;

const DRIVE_FOLDER_ID = '1C7isv1A0PwjVNHg3d7EjWhsIJHAaN7UA'; // "Claud Adjust Catalog"
const ALT_TAG = 'meta-catalog';

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const handleIdx = args.indexOf('--handle');
const targetHandles = handleIdx >= 0 ? args.slice(handleIdx + 1).filter(a => !a.startsWith('--')) : [];

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

// ─── Buscar produto e imagens existentes com alt="meta-catalog" ───────────────
async function getProduct(handle) {
  const data = await shopifyGQL(`{
    productByHandle(handle: "${handle}") {
      id
      media(first: 20) {
        edges {
          node {
            ... on MediaImage {
              id
              alt
            }
          }
        }
      }
    }
  }`);

  const product = data.productByHandle;
  if (!product) return null;

  const existingIds = product.media.edges
    .map(e => e.node)
    .filter(n => n.id && n.alt === ALT_TAG)
    .map(n => n.id);

  return { id: product.id, existingIds };
}

// ─── Remover imagens meta-catalog existentes ──────────────────────────────────
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

// ─── Staged upload ─────────────────────────────────────────────────────────────
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
  if (r.status !== 201) throw new Error(`Upload para staged falhou: HTTP ${r.status}`);
}

// ─── Adicionar imagem ao produto com alt="meta-catalog" ───────────────────────
async function addImageToProduct(productId, resourceUrl) {
  const data = await shopifyGQL(
    `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          ... on MediaImage { id alt }
        }
        mediaUserErrors { field message }
        product { id }
      }
    }`,
    {
      productId,
      media: [{
        originalSource: resourceUrl,
        alt: ALT_TAG,
        mediaContentType: 'IMAGE',
      }],
    }
  );
  const errors = data.productCreateMedia.mediaUserErrors;
  if (errors.length > 0) throw new Error(errors.map(e => e.message).join(', '));
}

// ─── Processar um produto ─────────────────────────────────────────────────────
async function processProduct(drive, file, handle, index, total) {
  const label = `[${index}/${total}] ${handle}`;

  const product = await getProduct(handle);
  if (!product) {
    console.log(`⚠  ${label} — não encontrado no Shopify`);
    return 'not_found';
  }

  if (dryRun) {
    const n = product.existingIds.length;
    console.log(`🔍 ${label} — OK${n > 0 ? ` (${n} imagem meta-catalog existente — seria removida)` : ''}`);
    return 'dry_run';
  }

  // Remove imagem meta-catalog anterior (evita duplicatas em re-runs)
  if (product.existingIds.length > 0) {
    await removeExistingImages(product.id, product.existingIds);
  }

  // Metadata do arquivo
  const meta = await drive.files.get({ fileId: file.id, fields: 'name,mimeType' });
  const filename = meta.data.name;
  const mimeType = meta.data.mimeType || 'image/jpeg';

  // Download do Drive para memória
  const download = await drive.files.get(
    { fileId: file.id, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  const imgBuffer = Buffer.from(download.data);

  // Staged upload → produto
  const staged = await createStagedUpload(filename, mimeType);
  await uploadToStaged(staged, imgBuffer, filename, mimeType);
  await addImageToProduct(product.id, staged.resourceUrl);

  console.log(`✅ ${label}`);
  return 'ok';
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!SHOPIFY_STORE || !SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    console.error('ERRO: SHOPIFY_STORE, SHOPIFY_CLIENT_ID e SHOPIFY_CLIENT_SECRET não configurados');
    process.exit(1);
  }
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    console.error('ERRO: Credenciais Google não configuradas — rode: node auth.js');
    process.exit(1);
  }

  await getShopifyToken();
  console.log('✅ Shopify autenticado\n');

  const oauth2 = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  // Listar arquivos na pasta do Drive
  const { data } = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields: 'files(id, name)',
    orderBy: 'name',
  });

  let files = data.files;

  if (targetHandles.length > 0) {
    files = files.filter(f => {
      const handle = f.name.replace(/\.[^.]+$/, '');
      return targetHandles.includes(handle);
    });
    if (files.length === 0) {
      console.error(`Nenhum arquivo encontrado para: ${targetHandles.join(', ')}`);
      process.exit(1);
    }
  }

  const mode = dryRun ? 'DRY-RUN' : 'UPLOAD';
  console.log(`Parabellum Meta Catalog — ${mode} — ${files.length} produto(s)\n${'─'.repeat(55)}`);

  const counts = { ok: 0, not_found: 0, erro: 0 };
  const erros = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const handle = file.name.replace(/\.[^.]+$/, '');

    try {
      const status = await processProduct(drive, file, handle, i + 1, files.length);
      if (status === 'ok' || status === 'dry_run') counts.ok++;
      else counts.not_found++;
    } catch (err) {
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
