import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function rewrite(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      await rewrite(path);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) {
      continue;
    }

    const source = await readFile(path, 'utf8');
    const output = source.replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2');

    if (output !== source) {
      await writeFile(path, output);
    }
  }
}

await rewrite(fileURLToPath(new URL('../dist/', import.meta.url)));
