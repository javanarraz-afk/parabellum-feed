// fix-drive-names.js — renomeia arquivos com nome errado na pasta Drive
// Cruza fileIds com o CATALOG para descobrir o handle correto.
// Rode: node fix-drive-names.js

require('dotenv').config();
const { google } = require('googleapis');

const DRIVE_FOLDER_ID = '1C7isv1A0PwjVNHg3d7EjWhsIJHAaN7UA';

const CATALOG = {
  '1XLqiB5ucrFwnuIHvISfFZLXes-uLbPgX': 'motoqueiro-fantasma-hcctl',
  '1fl9_UnMe5kkomoQgng12f9NycBw5qyRZ': 'foquiu-moder-foquer-7bl4k',
  '1rOiXNt8fHPOW3hpYBec9qHslq5rxukaH': 'caveira-do-mangue-4ivf4',
  '1Z1I8PwK1QhDxej0GxZKWbLWRF6HQTt1e': 'hell-de-janeiro-9o6ep',
  '1mf1sTY4JFPE4TPpG4fjizn2Uk0_PyDrd': 'com-honra-oqa6l',
  '1xxZnD85-YG_sctEiqtyfly1ncP-6DqTi': 'cancao-de-guerra-fcqgy',
  '1fVAPc3_I0gvll5PoN8rdprk38RoYYxjB': 'toca-do-caveira-u8kcf',
  '18Z8SSUQD7IojCVm9rPxDkZi4H-AnvIh5': 'long-barrel-uh09y',
  '1ftfZ-pEVO0cbrxlrtfkSn7gJDffpdxmL': 'cote-operacoes-taticas-especiais-saukt',
  '1euonWOfLJZRy5uF11wiSHgXgRjyeRmUE': 'spartans-choque-4budh',
  '1Mm_X7jrVVFTV9pp97u38ouOTM3VqwVzr': 'tubarao-nada-com-tubarao-7kx31',
  '1XLAWxNVZf3HgHbzzrhN19ZhGpQqIPu5U': 'taticanos-do-brasil-zwifx',
  '1e5KVcsHq1dWAPhY__WU4FoAvgwEtSr6C': 'true-love-jb9en',
  '1bPHhx0yK8R4W30meTbQRyaF1vdCjAIof': 'ser-ou-nao-ser-t-shirt-prime-0om6u',
  '1CBSPdIJyThnGzIiVLh4QQjMNp0pJDsNA': 'ser-choqueano-preta-o6nz1',
  '1xvmYAUC1Rv2axH_BE8lX0din79mH77zC': 'geodefense-52798',
  '1j1yM5WjTrCeUfgzIj5MoAsCxy-olK2KY': 'qap-y2d3y',
  '1zv4XRFknrqWQAZjwps7ff2Az3aP22YWy': 'regata-cagareandar-6yh9c',
  '1vkQw_YhGgWbR42mKtPoC0uq5V6noNVQI': 'nemesis-rotam-cor-preta-ibbxd',
  '19yXjto-pXJTdKzTHTpRfaXuazYnGA-Pd': 'long-barrel-preta-sehlu',
  '1sLUezhEgv3PzNi8S5j3bswTEF5KMSb0A': 'garrafa-termica-mansinho-u70nm',
  '1jxVEIQEV4WmcTaKsR72xufMYYIqd4S_q': 'raio-imortal-ekt2h',
  '1845InZWksKkHLZhQzsDyMMLB4aWRHXPO': 'flor-da-morte-h3qzt',
  '1kQNEG8XEkkc02BMBNJtZ6E-N2Kw5b5EQ': 'bad-rider-d66yx',
  '1JIbLinX8F91GX4OEJRhxjkE8GYIznF44': 'caminho-para-o-inferno-camiseta-estonada-4mb08',
  '1YDKqOEMCOroS4_N-N6GCb7aXDsIdht26': 'falcao-07-soa84',
  '1v4Zc_T4Fu5ziwWHDMFdVhyMCgyeJ2ZZJ': 'cate-acoes-taticas-especiais-kgl7e',
  '1HDwIBF3bkXFBM--ANecz03-BKMF8DduO': 'cavaleiros-de-aco-do-brasil-9gyuc',
  '1wRUsuT9tqAgWKYCgZUQdnbTQvjhWPh7U': 'choqueanos-do-brasil-9klbv',
  '1KxMj4-jKxMOmTqRm6FKwDHETbwKyfD6q': 'cate-acoes-taticas-especiais-v2-2ktha',
  '1WGr54BRbIs3ptuD5ebpj2CC8bbvvmVNX': 'espiritos-da-guerra-preta-dqbj6',
  '1Ds919ZcCzqYXaYeMpemrZPR-ymBouf9M': 'cavaleiros-de-aco-do-brasil-preta-lbltz',
  '1sEyucP8-Eks_vxnj74eA-PzquKFQMCrd': 'ate-chorei-9una3',
  '1XNnWBol3QST5IcU6QQItCqrB_LGpzT0v': 'toca-a-sanfona-qym92',
  '1wa8NDqfYyZnudVCfYWZ1OjUI1IbG60xm': 'ser-choqueano-versao-prime-175g-x51jk',
  '1mcSY950VgHpDnuXAKAyTUJoQTL1-EDTl': 'nuvens-infinitas-d0y5w',
  '1rpKB-xt45Ort-PRwzBaqM6wMx7swSbh8': 'guerreiro-da-caatinga-m80zd',
  '1BSsPojTcqq0X9mCM9euqy2oQMoQozK-W': 'so-a-violencia-gera-compreensao-jz711',
  '1KujvWJMpw2IXBnkuwLQixtzYb2-7EISB': 'sun-tzu-aqnok',
  '1C7hlclQjO1q_W2svahSMYPXMlye7jGNd': 'spartans-estampa-branca-soim1',
  '1wabhIQzT35rxnKAd6iWs9zWrYgchx1dW': 'patentes-do-eb-a-cobra-vai-fumar-fwv7w',
  '1EFGpKC7hAFllta5d-vZ2ybKCAcvTgJ9F': 'nao-vai-dar-nada-so-confia-u3jy5',
  '16EpwbKShGM1P44lbYOxU_CMW2HiH8Iu1': 'maldito-cao-de-guerra-054vl',
  '13rhdQm9XlM497OekY7lxgKEThJUfHZ5i': 'seja-um-homem-simples-tecido-estonado-gmadb',
  '1OSMNwCKomka0yLbJaOlkUAOlAygrF95l': 'gunner-vnay2',
  '1Ckm0hhs8gWLnxmE7FCjENGHS4xnmHGx9': 'oracao-do-choqueano-wvv8p',
  '1tcPTGmBgcMmGUuH1DtOTs5NoEwkBBhGV': 'beba-com-responsabilidade-37zu2',
  '1bKKIPUaYOeUyMvNjizn1iWD0Jz5EWN4m': 'ar-mods-black-dec0g',
  '1lLGMLI0eYx_kZelmqOc7f3LCOKCoGlM0': 'descolador-de-placas-gwf9g',
  '1mjOOuWz9Tz5JMjQdosD1E0scl5G1tdBe': 'onca-pintada-quem-te-pintou-rrap8',
  '1WwrZT42OjMHe0OD99EaY7TOrIDlyEKmj': 'drops-de-balinha-c4u5w',
  '1TUyLJxpx0vg680G-5yySkzCbxUNOKaxo': 'broncas-f3f1t',
  '1yFRFJnxvRbAK4W2cFGAQvHmtb06dXxS_': 'choqueano-00-4m7si',
  '1BHB2_U-BhNCBY6veQtTPhfkguM9cM1DC': 'pfem-puobq',
  '118c5zBbEcTsQ_N7aNxIWQYalEUgPIduz': 'pfem-cropped-0jzw5',
  '1d3rSRqyRt9SBvmvRu6epFfdyQtzuYxD5': 'pisciana-a-que-mata-sorrindo-em-silencio-owna5',
  '1fABiEP1yVuzDkp1BliVD8ybmMF_SGTAI': 'satanaries-a-briguenta-mv507',
  '1MRRiVkw7pn_PjzuXdAOrwqbFsQn9hE-G': 'sagitariana-a-louca-de-granada-3j7r1',
  '1NX4U2qavozftl1SbLsRokfTcay8ETT2n': 'taurina-a-birrenta-iwh8l',
  '1K7btfU5ZUUYEJudZpRKtzNi0A3hL0mYn': 'querencia-babylook-feminina-pt2tb',
  '1N6bJ1ls7D39ZyeDo5xiA49Cc3ahd-f-h': 'leonina-a-egogenia-utcs2',
  '1XrnVa--azjZh0yZ8wJhY44oat68daIur': 'libriana-a-julgadora-pcuob',
  '1pMtGlVWH42fTC-Cxq4-RZhtpwR9uFIF4': 'virginiana-a-perfeccionista-tatica-e69sh',
  '1zbTBo79WoYJbjKoDhrwl-pP3iLAW1wu4': 'gemini-a-dupla-personalidade-4p3yc',
  '1C2DauDjFStLdGmbGuMZHBkvoKbvUNp5w': 'femme-fatale-87lkf',
  '1dj7i25Xbfrh46vAWdAFll8XRbVyOvqnc': 'sagitariana-a-louca-de-granada-swcw1',
  '1lMilGOfSzaYhSZlKQk0rTJaACt3XgdkP': 'escorpiana-a-venenosa-fatal-3ypmj',
  '1msYf61eKHkw1cntXM9ZFV7Kb5g352Lun': 'delicada-e-perigosa-5mpe8',
  '1DcqOX1o34PtdvncXxRGq8yfSuMcLXnFu': 'cropped-bronca-s-odrz2',
  '1y2rkgpzgWxxSvOMRQXwmJaPadb2poWII': 'capricorniana-a-perseguidora-psicopata-8u16r',
  '1a6R1g12jUT-cmaogWYamhskPsy43WsDj': 'aquariana-fria-como-o-gelo-nvgb0',
  '1pOZFvXe5OlWlYxceb6srsGrOqZn2ZSj-': 'canceriana-a-sensivel-armada-tryfl',
  '1K16F4flWTWGWluctB9Sq42vDMwr4H1FP': 'big-shoes-4vtsf',
  '1ehJMtIDRYeLxva3hU6SPiCR3o-P-CQ1U': 'big-shoes-cropped-nx4j5',
  '1T-EiAToY8OxpwNYuRXzxetvK5_EZrY2q': 'broncas-o4ts0',
};

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function main() {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  const drive = google.drive({ version: 'v3', auth: oauth2 });

  const { data } = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType)',
    orderBy: 'name',
  });

  const toRename = [];
  const notImage = [];
  const unknown = [];

  for (const file of data.files) {
    const ext          = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const currentHandle = file.name.replace(/\.[^.]+$/, '');
    const correctHandle = CATALOG[file.id];
    const isImage       = IMAGE_TYPES.includes(file.mimeType);

    if (!isImage) {
      notImage.push(file);
      console.log(`🚫 "${file.name}" — tipo ${file.mimeType} (não é imagem, ignorar)`);
      continue;
    }

    if (!correctHandle) {
      // fileId não está no CATALOG — arquivo novo sem mapeamento
      unknown.push(file);
      console.log(`❓ "${file.name}" — id ${file.id} não está no CATALOG`);
      continue;
    }

    if (currentHandle !== correctHandle) {
      const newName = correctHandle + ext;
      toRename.push({ file, newName });
      console.log(`🔧 "${file.name}" → "${newName}"`);
    }
  }

  if (toRename.length === 0) {
    console.log('\n✅ Nenhum arquivo de imagem precisa ser renomeado.');
  } else {
    console.log(`\nRenomeando ${toRename.length} arquivo(s)...\n`);
    for (const { file, newName } of toRename) {
      await drive.files.update({ fileId: file.id, requestBody: { name: newName } });
      console.log(`  ✅ "${file.name}" → "${newName}"`);
    }
  }

  if (notImage.length > 0) {
    console.log(`\n⚠  ${notImage.length} arquivo(s) ignorados (não são imagem):`);
    notImage.forEach(f => console.log(`   "${f.name}" (${f.mimeType})`));
  }

  if (unknown.length > 0) {
    console.log(`\n⚠  ${unknown.length} arquivo(s) sem mapeamento no CATALOG (produtos novos?):`);
    unknown.forEach(f => console.log(`   "${f.name}" — id: ${f.id}`));
    console.log('   → Renomeie manualmente no Drive com o handle exato do produto Shopify.');
  }

  console.log('');
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
