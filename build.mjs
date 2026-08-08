import { execFile } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

// The target is a fixed child of this repository, never a caller-provided path.
await rm(dist, { recursive: true, force: true });

await execFileAsync(
    process.execPath,
    [join(here, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(here, 'tsconfig.build.json')],
    { cwd: here },
);

await useGridsBuiltEntryPoints();

await build({
    // Complete public stack: the host port plus every control built against it.
    // Bundled, so the grid is inlined here and no specifier survives to be
    // resolved by whoever loads the file.
    entryPoints: [join(here, 'src', 'index.ts')],
    outfile: join(dist, 'sstradingcontrols.js'),
    globalName: 'SSTradingControls',
    bundle: true,
    format: 'iife',
    sourcemap: true,
    target: 'es2020',
    logLevel: 'info',
});

/// Move the emitted files — and only them — onto `@stocksharp/grids`'s BUILT
/// entry points.
///
/// The sources import the grid as `@stocksharp/grids/source/data-grid`, and that
/// is deliberate: `./source/*` is an unconditional path to the grid's own
/// TypeScript, which is what the two toolchains that compile these controls
/// from source both need. The terminal bundles them as .ts through esbuild, and
/// its unit tests bundle as CommonJS — while the grid's compiled entry points
/// declare only an `import` condition, so a CommonJS bundle cannot resolve them
/// at all.
///
/// It is exactly the wrong thing to publish, though. tsc copies an import
/// specifier through untouched, so without this the emitted `dist/esm/*.js`
/// would still say `./source/data-grid`, which resolves to a raw `.ts` file:
/// an adopter importing the package's own ESM entry gets ERR_MODULE_NOT_FOUND
/// from inside node_modules, on a package that installed cleanly.
///
/// Rewriting after the emit rather than switching the sources over keeps both
/// halves honest: source depends on the grid's source, dist depends on the
/// grid's dist, and neither has to be built for the other to work.
async function useGridsBuiltEntryPoints() {
    const rewritten = [];
    for (const path of await emittedFiles(dist)) {
        const before = await readFile(path, 'utf8');
        const after = before.replaceAll('@stocksharp/grids/source/', '@stocksharp/grids/');
        if (after === before) continue;
        await writeFile(path, after, 'utf8');
        rewritten.push(path);
    }
    console.log(`grid specifiers moved to the built entry points in ${rewritten.length} emitted files`);
}

/// The JavaScript and the declarations tsc just wrote. Source maps are left
/// alone: they carry the original source, whose specifier is the correct one
/// for it.
async function emittedFiles(directory) {
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) result.push(...await emittedFiles(path));
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts')) result.push(path);
    }
    return result;
}
