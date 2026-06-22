# Parabellum — Meta Catalog Feed

Feed RSS para Meta Commerce Manager com imagens 1:1 customizadas via Shopify + Google Drive.

---

## Estrutura do projeto

```
server.js          → servidor do feed RSS (deploy no Render)
upload/            → scripts para subir imagens no Shopify
  meta-catalog-upload.js  → script principal de upload
  auth.js                 → gera Google OAuth refresh token (rodar 1x)
  fix-drive-names.js      → diagnóstico de nomes errados no Drive
  .env.example            → template de variáveis de ambiente
```

---

## Como funciona

1. Imagens 1:1 são salvas no Google Drive (pasta "Claud Adjust Catalog")
2. O script `meta-catalog-upload.js` pega cada imagem e sobe para o produto correspondente no Shopify com `alt="meta-catalog"`
3. O servidor `server.js` lê os produtos do Shopify, filtra imagens com `altText === "meta-catalog"` e gera um feed RSS completo
4. O feed é cadastrado no Meta Commerce Manager como **única fonte de dados**

---

## Configurar um catálogo NOVO no Meta (do zero, sem dor de cabeça)

### Regra de ouro
**NÃO conecte o Shopify como fonte de dados no Meta.** Conectar o Shopify cria itens duplicados (um por variante) e o Meta fica sobrescrevendo os dados do feed. Use SOMENTE o feed RSS abaixo.

---

### 1. Deploy do servidor (Render)

O servidor já está em `https://parabellum-feed.onrender.com/feed`

Se precisar de novo deploy:
1. Fork este repo
2. Crie conta no [render.com](https://render.com)
3. New Web Service → conecta o repo → Build Command: `npm install` → Start Command: `node server.js`
4. Variáveis de ambiente no Render:
   ```
   SHOPIFY_STORE=SEU-STORE.myshopify.com
   SHOPIFY_CLIENT_ID=...
   SHOPIFY_CLIENT_SECRET=...
   ```

---

### 2. Criar catálogo no Meta Commerce Manager

1. Acesse [business.facebook.com/commerce](https://business.facebook.com/commerce)
2. **Criar catálogo** → Tipo: E-commerce
3. No catálogo criado → **Fontes de dados → + Adicionar → Feed de dados → Usar uma URL**
4. URL: `https://parabellum-feed.onrender.com/feed`
5. Frequência: **Diária**
6. Salvar e aguardar o primeiro sync (~5 minutos)

> **NÃO adicione o Shopify como fonte.** O feed já tem todos os campos necessários.

---

### 3. Verificar se o feed tem tudo que o Meta precisa

O feed envia por produto:
- `g:id` → handle do produto (ex: `long-barrel-uh09y`)
- `g:title` → nome do produto
- `g:description` → descrição curta (até 500 chars)
- `g:link` → URL da página do produto
- `g:image_link` → imagem 1:1 do Drive
- `g:price` → menor preço das variantes (ex: `299.90 BRL`)
- `g:availability` → sempre `in stock`
- `g:condition` → sempre `new`
- `g:brand` → `Parabellum Store`

Produtos **sem** imagem com `alt="meta-catalog"` no Shopify **não aparecem no feed** — isso é proposital.

---

### 4. Subir imagens no Shopify

#### Pré-requisitos
- Node.js instalado
- Pasta no Google Drive com imagens nomeadas como `handle-do-produto.png`
- Credenciais Shopify (Client ID + Secret) de um app privado com permissão `write_products`
- Credenciais Google OAuth

#### Setup inicial (uma vez)

```bash
cd upload/
cp .env.example .env
# preencha o .env com suas credenciais
npm install
node auth.js   # abre o navegador, autoriza o Google Drive e salva o token no .env
```

#### Nomear os arquivos no Drive

Cada arquivo deve ter o nome exato do handle Shopify + extensão:
```
long-barrel-uh09y.png
geodefense-52798.png
sun-tzu-aqnok.jpg
```

Para descobrir o handle de um produto: na Shopify Admin, abra o produto → veja a URL → o handle é o trecho após `/products/`.

#### Subir as imagens

```bash
# testar sem subir nada
node meta-catalog-upload.js --dry-run

# subir tudo
node meta-catalog-upload.js

# subir produto específico
node meta-catalog-upload.js --handle long-barrel-uh09y

# subir vários produtos
node meta-catalog-upload.js --handle long-barrel-uh09y geodefense-52798
```

O script:
- Remove imagem anterior com `alt="meta-catalog"` (evita duplicatas em re-runs)
- Faz upload via staged upload para o Shopify
- A imagem fica como imagem adicional do produto (não substitui a capa)

#### Forçar atualização do feed após uploads

```
https://parabellum-feed.onrender.com/refresh
```

> Aguarde ~30 segundos após os uploads antes de chamar o /refresh, pois o Shopify processa as imagens de forma assíncrona.

---

### 5. Conectar o feed a um anúncio / Shop no WhatsApp

1. No Meta Business Suite → selecione o catálogo criado
2. Configurações → Lojas / Canais → adicionar canal WhatsApp
3. Associar ao número de WhatsApp Business desejado

---

## Variáveis de ambiente

### Servidor (Render)

| Variável | Descrição |
|----------|-----------|
| `SHOPIFY_STORE` | Ex: `parabellum-br.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | ID do app privado Shopify |
| `SHOPIFY_CLIENT_SECRET` | Secret do app privado Shopify |

### Script de upload (upload/.env)

| Variável | Descrição |
|----------|-----------|
| `SHOPIFY_STORE` | mesmo acima |
| `SHOPIFY_CLIENT_ID` | mesmo acima |
| `SHOPIFY_CLIENT_SECRET` | mesmo acima |
| `GOOGLE_CLIENT_ID` | ID do projeto no Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Secret do projeto no Google Cloud |
| `GOOGLE_REFRESH_TOKEN` | Gerado pelo `node auth.js` |

---

## IDs de referência (conta atual)

- **Pasta no Drive:** `1C7isv1A0PwjVNHg3d7EjWhsIJHAaN7UA` (Claud Adjust Catalog)
- **Feed URL:** `https://parabellum-feed.onrender.com/feed`
- **Refresh URL:** `https://parabellum-feed.onrender.com/refresh`

---

## Endpoints do servidor

| Endpoint | Descrição |
|----------|-----------|
| `GET /feed` | Feed RSS (cache de 1 hora) |
| `GET /refresh` | Força recarregar o feed do Shopify agora |
| `GET /` | Status do servidor |
