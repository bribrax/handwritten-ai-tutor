import { defineConfig, type Plugin } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// HTTPS : certificat mkcert si présent (certs/dev.pem + certs/dev-key.pem), sinon certificat auto-signé.
const certFile = 'certs/dev.pem';
const keyFile = 'certs/dev-key.pem';
const mkcert = existsSync(certFile) && existsSync(keyFile);
const https = mkcert ? { cert: readFileSync(certFile), key: readFileSync(keyFile) } : undefined;

/** Dossier de la CA locale mkcert (jamais sa clé privée !). */
function dossierCA(): string | null {
  try {
    return execSync('mkcert -CAROOT', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Dev uniquement : sert la CA publique pour l'installer sur l'iPad (https://IP:5173/mkcert-ca.crt). */
function serveCA(): Plugin {
  return {
    name: 'serve-mkcert-ca',
    configureServer(server) {
      const dir = dossierCA();
      const fichier = dir && join(dir, 'rootCA.pem');
      if (!fichier || !existsSync(fichier)) return;
      server.middlewares.use('/mkcert-ca.crt', (_req, res) => {
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.end(readFileSync(fichier));
      });
    },
  };
}

export default defineConfig({
  plugins: [
    mkcert ? [] : basicSsl(),
    serveCA(),
    VitePWA({
      registerType: 'prompt', // la mise à jour ne recharge jamais la page en plein tracé
      injectRegister: false, // enregistrement fait dans main.ts
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'Tutorat',
        short_name: 'Tutorat',
        lang: 'fr',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        background_color: '#d9d9d9',
        theme_color: '#d9d9d9',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,png,svg,webmanifest,woff2}'] },
    }),
  ],
  server: { host: true, port: 5173, https },
  preview: { host: true, port: 4173, https },
});
