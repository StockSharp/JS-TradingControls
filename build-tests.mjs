import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, 'tests', '_dist');

await rm(outdir, { recursive: true, force: true });
await build({
    entryPoints: [join(here, 'tests', '*.test.ts')],
    outdir,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outExtension: { '.js': '.cjs' },
    target: 'node20',
    external: ['node:*'],
    logLevel: 'info',
});
