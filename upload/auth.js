// auth.js — Gera o Google OAuth refresh token e salva no .env
// Rode UMA VEZ: node auth.js
// Depois use: node meta-catalog-upload.js

require('dotenv').config();
const { google } = require('googleapis');
const http = require('http');
const url = require('url');
const fs = require('fs');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3001/callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nERRO: Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env\n');
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/drive.readonly'],
  prompt: 'consent',
});

console.log('\nAbrindo navegador para autenticação Google...');
console.log('Se não abrir, acesse:\n');
console.log(authUrl + '\n');

const { exec } = require('child_process');
exec(`start "" "${authUrl}"`);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/callback') return;

  const code = parsed.query.code;
  if (!code) { res.end('Erro: código não encontrado.'); return; }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    let envContent = fs.readFileSync('.env', 'utf8');
    if (envContent.includes('GOOGLE_REFRESH_TOKEN=')) {
      envContent = envContent.replace(/GOOGLE_REFRESH_TOKEN=.*/g, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      envContent += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`;
    }
    fs.writeFileSync('.env', envContent);
    res.end('<h2>✅ Autenticação concluída! Pode fechar esta aba.</h2>');
    console.log('\n✅ Token salvo no .env');
    console.log('Agora rode: node meta-catalog-upload.js --dry-run\n');
    server.close();
  } catch (err) {
    res.end(`Erro: ${err.message}`);
    console.error('Erro:', err.message);
    server.close();
  }
});

server.listen(3001, () => {
  console.log('Aguardando callback em http://localhost:3001/callback ...\n');
});
