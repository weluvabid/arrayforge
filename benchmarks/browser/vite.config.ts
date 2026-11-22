import { fileURLToPath } from 'node:url';
import { posix } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';

function inlineGeneratedCss(): Plugin {
  return {
    name: 'arrayforge-inline-generated-css',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle(_options, bundle) {
      const htmlAsset = Object.values(bundle).find(
        (asset) => asset.type === 'asset' && asset.fileName.endsWith('.html'),
      );
      const cssAssets = Object.values(bundle).filter(
        (asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'),
      );

      if (
        !htmlAsset ||
        !('source' in htmlAsset) ||
        typeof htmlAsset.source !== 'string' ||
        cssAssets.length === 0
      ) {
        throw new Error('Expected the browser build to emit index.html and its generated CSS.');
      }

      const htmlDirectory = posix.dirname(htmlAsset.fileName);
      const inlineCss = cssAssets
        .map((asset) => {
          if (!('source' in asset)) {
            throw new Error(`Expected emitted CSS asset to contain text: ${asset.fileName}`);
          }

          const cssSource =
            typeof asset.source === 'string'
              ? asset.source
              : new TextDecoder().decode(asset.source);
          const cssDirectory = posix.dirname(asset.fileName);
          return cssSource.replace(
            /url\((['"]?)(?!data:|https?:|\/|#)([^'")]+)\1\)/g,
            (_match, quote: string, url: string) => {
              const resolvedPath = posix.normalize(posix.join(cssDirectory, url.trim()));
              let relativePath = posix.relative(htmlDirectory, resolvedPath);

              if (!relativePath.startsWith('.')) {
                relativePath = `./${relativePath}`;
              }

              return `url(${quote}${relativePath}${quote})`;
            },
          );
        })
        .join('\n');

      const htmlWithoutCssLinks = htmlAsset.source.replace(
        /\s*<link\b(?=[^>]*\brel=["']stylesheet["'])[^>]*>/gi,
        '',
      );

      if (!htmlWithoutCssLinks.includes('</head>')) {
        throw new Error(`Could not find the closing head tag in ${htmlAsset.fileName}.`);
      }

      htmlAsset.source = htmlWithoutCssLinks.replace(
        '</head>',
        `  <style>\n${inlineCss}\n  </style>\n  </head>`,
      );

      for (const asset of cssAssets) {
        delete bundle[asset.fileName];
      }
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [tailwindcss(), inlineGeneratedCss()],
  server: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('../../dist/benchmarks/browser', import.meta.url)),
    emptyOutDir: true,
  },
});
