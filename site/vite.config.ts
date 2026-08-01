import fs from 'fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Replaces %FACTS_*% tokens in index.html (the static hero shell) from the
 *  generated src/facts.json, so the pre-React markup can never drift from
 *  what Hero.tsx renders. */
const factsHtml = (): Plugin => {
  const facts = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'src/facts.json'), 'utf8'),
  );
  return {
    name: 'facts-html',
    transformIndexHtml(html) {
      return html.replaceAll('%FACTS_VERSION_BASE%', facts.versionBase);
    },
  };
};

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // When running behind the portless proxy (which sets PORT), the HMR
        // client must connect back through the proxy port, not Vite's own
        // port — otherwise the websocket fails and open tabs never reload.
        hmr: process.env.PORT
          ? { clientPort: Number(process.env.PORTLESS_PORT) || 1355 }
          : undefined,
      },
      plugins: [react(), factsHtml()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        rollupOptions: {
          output: {
            manualChunks(id: string) {
              if (!id.includes('node_modules')) return undefined;
              // Match only the real react packages — a bare '/react/' check
              // also catches '@wterm/react' and drags the whole terminal
              // renderer into the eager chunk.
              if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
              if (id.includes('lucide-react')) return 'icons';
              // Everything else (framer-motion, @wterm, ...) splits by usage:
              // statically-imported cores land in the entry chunk, code that
              // is only reached through dynamic imports stays lazy. Forcing
              // named chunks here would eagerly load code that only lazy
              // components need.
              return undefined;
            },
          },
        },
      }
    };
});
