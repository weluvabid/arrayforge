import { rm } from 'node:fs/promises';

for (const path of ['dist', 'coverage', 'reports']) {
  await rm(path, { recursive: true, force: true });
}
