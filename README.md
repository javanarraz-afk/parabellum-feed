# Parabellum — Meta Catalog Feed

Feed RSS para Meta Commerce Manager com imagens 1:1 customizadas via Shopify.

---

## Estado atual (22/06/2026)

### O que está funcionando
- Servidor rodando em `https://parabellum-feed.onrender.com`
- Feed com **39 produtos / 761 variantes** (produtos que têm imagem com `alt="meta-catalog"` no Shopify)
- Catálogo **"Parabellum Catalog"** criado no Meta Commerce Manager apontando para o feed
- Estrutura correta: variante como item, produto como grupo — pixel e catálogo casam

### O que falta
- **36 produtos ainda sem imagem 1:1** — o upload script precisa rodar para esses produtos (de 75 esperados, 39 já têm imagem)
- **Sincronização completa do catálogo** — após forçar o re-sync no Commerce Manager, devem aparecer os 39 produtos (hoje mostra 4 porque o Meta buscou o feed antes do Render estar ativo)
- **Verificar retargeting** — após o catálogo estar completo, confirmar que `content_ids` do pixel bate com os IDs do feed

---

## Por que esse projeto existe

O app oficial Shopify-Meta gerava itens em nível de variante com IDs no formato `shopify_BR_[productID]_[variantID]`. Isso criava múltiplos itens por produto no catálogo, quebrava a lojinha do WhatsApp/Instagram, e as imagens de capa vinham cortadas pelo Meta (o produto é estampa — precisa de imagem 1:1 em close).

**Solução:** feed RSS próprio com imagens 1:1 já hospedadas no CDN da Shopify, estrutura de variantes agrupadas por produto via `g:item_group_id`, e IDs que casam com o que o pixel dispara.

---

## Arquitetura da solução

### Por que não desinstalar o app da Meta

O app da Meta instala um **web pixel sandboxed** — ele não é editável via tema. Esse pixel dispara `content_ids` com o **variant ID numérico** do Shopify (ex: `48786087379200`) e `content_type: product`. Desinstalar o app remove o pixel junto. Conclusão: **manter o app instalado** para preservar o pixel. O problema era só o catálogo, não o pixel.

### Como o feed funciona

```
Shopify (produtos ativos com alt="meta-catalog")
    → server.js (Render)
    → feed RSS em /feed
    → Meta Commerce Manager (sincroniza diariamente)
```

### Estrutura de cada item no feed

```xml
<item>
  <g:id>48786087379200</g:id>              <!-- variant ID numérico — casa com pixel -->
  <g:item_group_id>8234567890123</g:item_group_id>  <!-- product ID — agrupa variantes -->
  <g:title>Nome do Produto</g:title>
  <g:description>Descrição curta</g:description>
  <g:link>https://parabellumstore.com.br/products/handle</g:link>
  <g:image_link>https://cdn.shopify.com/.../imagem-1x1.jpg</g:image_link>
  <g:price>89.90 BRL</g:price>
  <g:availability>in stock</g:availability>
  <g:condition>new</g:condition>
  <g:brand>Parabellum Store</g:brand>
</item>
```

**Por que um item por variante e não por produto:**
O pixel da Meta dispara o variant ID como `content_ids`. Para retargeting e atribuição funcionarem, o `g:id` do feed precisa casar exatamente. O Meta agrupa as variantes automaticamente pelo `g:item_group_id`, mostrando um único produto na lojinha com a imagem 1:1.

### Por que as imagens funcionam assim

1. Imagens 1:1 (close na estampa) foram salvas no Google Drive na pasta "Claud Adjust Catalog"
2. O script `upload/meta-catalog-upload.js` fez upload dessas imagens para cada produto no Shopify com `altText = "meta-catalog"`
3. O servidor filtra apenas imagens com esse alt text — todos os produtos sem essa imagem ficam fora do feed (intencional)

---

## Regra de ouro

**NÃO conecte o Shopify como fonte de dados no Meta Commerce Manager.** Isso cria itens duplicados e o Meta sobrescreve os dados do feed. Use **somente** o feed RSS.

O app da Meta pode continuar instalado — só não use o catálogo que ele gera.

---

## Endpoints do servidor

| Endpoint | Descrição |
|----------|-----------|
| `GET /feed` | Feed RSS (cache de 1 hora) |
| `GET /refresh` | Força recarregar o feed do Shopify agora |
| `GET /debug` | Lista todos os produtos/variantes do feed com IDs — usar para comparar com o pixel |
| `GET /publications` | Lista canais de venda da Shopify (para identificar canal Facebook) |
| `GET /` | Status do servidor e idade do cache |

---

## Próximas ações (em ordem)

### 1. Forçar re-sync do catálogo no Meta
Commerce Manager → Fontes de dados → clicar na fonte do feed → "Atualizar agora"
Aguardar ~5 minutos. Devem aparecer 39 produtos agrupados.

### 2. Completar o upload das imagens restantes
36 produtos ainda não têm imagem 1:1 (de 75 esperados, 39 já processados).

```bash
cd upload/
node meta-catalog-upload.js --dry-run   # ver quais faltam
node meta-catalog-upload.js             # subir todos que faltam
```

Depois:
```
https://parabellum-feed.onrender.com/refresh
```

### 3. Verificar retargeting
Após o catálogo completo, confirmar que um evento `ViewContent` no site retorna um produto matched no Commerce Manager → Diagnóstico → Correspondência de eventos.

### 4. Configurar lojinha no WhatsApp / Instagram (opcional)
Commerce Manager → Configurações → Lojas / Canais → adicionar canal WhatsApp Business.

---

## Como subir imagens para produtos novos

```bash
cd upload/

# testar sem subir nada
node meta-catalog-upload.js --dry-run

# subir tudo que ainda não tem imagem meta-catalog
node meta-catalog-upload.js

# subir produto específico pelo handle
node meta-catalog-upload.js --handle nome-do-handle

# forçar atualização do feed após uploads
# aguardar ~30s depois dos uploads antes de chamar o refresh
curl https://parabellum-feed.onrender.com/refresh
```

O handle de um produto está na URL do produto no admin Shopify: `/products/[handle]`.

---

## Variáveis de ambiente

### Servidor (Render)

| Variável | Descrição |
|----------|-----------|
| `SHOPIFY_STORE` | Ex: `parabellum-br.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | ID do app privado Shopify |
| `SHOPIFY_CLIENT_SECRET` | Secret do app privado Shopify |

### Script de upload (`upload/.env`)

| Variável | Descrição |
|----------|-----------|
| `SHOPIFY_STORE` | mesmo acima |
| `SHOPIFY_CLIENT_ID` | mesmo acima |
| `SHOPIFY_CLIENT_SECRET` | mesmo acima |
| `GOOGLE_CLIENT_ID` | ID do projeto no Google Cloud |
| `GOOGLE_CLIENT_SECRET` | Secret do projeto no Google Cloud |
| `GOOGLE_REFRESH_TOKEN` | Gerado pelo `node auth.js` (rodar 1x) |

---

## IDs de referência

- **Feed URL:** `https://parabellum-feed.onrender.com/feed`
- **Refresh URL:** `https://parabellum-feed.onrender.com/refresh`
- **Debug URL:** `https://parabellum-feed.onrender.com/debug`
- **Pixel ativo:** Parabellum t-shirts's pixel (ID: 1025951693198559)
- **Catálogo Meta:** Parabellum Catalog
- **Pasta Google Drive:** `1C7isv1A0PwjVNHg3d7EjWhsIJHAaN7UA` (Claud Adjust Catalog)

---

## Estrutura do projeto

```
server.js                    → servidor do feed RSS (deploy no Render)
upload/
  meta-catalog-upload.js     → sobe imagens 1:1 do Drive para o Shopify
  auth.js                    → gera Google OAuth refresh token (rodar 1x)
  fix-drive-names.js         → diagnóstico de nomes errados no Drive
  .env.example               → template de variáveis de ambiente
```
