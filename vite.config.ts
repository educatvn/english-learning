import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/english-learning/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'captions-api',
      apply: 'serve' as const,
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (req.url !== '/api/save-captions' || req.method !== 'POST') {
            return next();
          }

          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req as AsyncIterable<Buffer>) {
              chunks.push(chunk);
            }
            const { videoId, captions } = JSON.parse(Buffer.concat(chunks).toString()) as {
              videoId: string;
              captions: unknown;
            };

            const videoDir = join(process.cwd(), 'public', 'videos', videoId);
            mkdirSync(videoDir, { recursive: true });
            writeFileSync(join(videoDir, 'captions.json'), JSON.stringify(captions));

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/youtube-proxy': {
        target: 'https://www.youtube.com',
        changeOrigin: true,
        secure: true,
        rewrite: path => path.replace(/^\/youtube-proxy/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          Accept: '*/*',
          Origin: 'https://www.youtube.com',
          Referer: 'https://www.youtube.com/',
        },
      },
    },
  },
});
