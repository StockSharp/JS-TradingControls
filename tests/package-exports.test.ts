// Every control the package builds must be one a consumer can import.
//
// `exports` is a hand-kept list, and the four controls added in 1.3.0 were built, tested,
// documented and shipped inside the bundle while being absent from it — so a host importing
// `@stocksharp/trading-controls/statistics-widget` got "module not found" from a package that
// visibly contains the module. Nothing failed here, because nothing here read the list.
//
// So this reads it: every widget module gets both entry shapes, every target exists on disk,
// and the two shapes agree about which module they point at.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const exportsMap: Record<string, unknown> = pkg.exports;

/// Modules a consumer imports directly. Widgets, plus the shared vocabulary their signatures
/// mention — a host that mounts a control has to name the types it hands over.
const SHARED = ['trading-host', 'control-types', 'formatters', 'dom', 'trading-data'];

function widgetModules(): string[] {
    return readdirSync('src')
        .filter(name => name.endsWith('-widget.ts'))
        .map(name => basename(name, '.ts'))
        .sort();
}

describe('the package exports', () => {
    it('name every control the package builds', () => {
        const missing = widgetModules().filter(module => exportsMap[`./${module}`] === undefined);

        assert.deepStrictEqual(missing, [], `built but not importable: ${missing.join(', ')}`);
    });

    it('offer every control as source as well as built', () => {
        const missing = widgetModules().filter(module => exportsMap[`./source/${module}`] === undefined);

        assert.deepStrictEqual(missing, [], `no source entry: ${missing.join(', ')}`);
    });

    it('name the shared vocabulary a host has to import to call one', () => {
        const missing = SHARED.filter(module =>
            exportsMap[`./${module}`] === undefined || exportsMap[`./source/${module}`] === undefined);

        assert.deepStrictEqual(missing, [], `not importable: ${missing.join(', ')}`);
    });

    it('point at files that exist', () => {
        const targets: string[] = [];
        for (const [name, entry] of Object.entries(exportsMap)) {
            if (typeof entry === 'string') targets.push(entry);
            else if (entry !== null && typeof entry === 'object')
                for (const path of Object.values(entry as Record<string, string>)) targets.push(path);
            assert.ok(name.startsWith('.'), `${name} is not a subpath`);
        }

        // `dist/` is a build output, so only check it when a build has run — the source entries
        // and the data files are in the repository either way.
        const built = existsSync(join('dist', 'esm', 'index.js'));
        const missing = targets
            .filter(path => built || !path.startsWith('./dist/'))
            .filter(path => !existsSync(path));

        assert.deepStrictEqual(missing, [], `exports point at missing files: ${missing.join(', ')}`);
    });

    it('agree between the two shapes about which module each names', () => {
        for (const [name, entry] of Object.entries(exportsMap)) {
            if (!name.startsWith('./source/')) continue;
            const built = exportsMap[name.replace('./source/', './')];
            if (built === undefined) continue;

            const module = String(entry).replace('./src/', '').replace('.ts', '');
            const target = (built as { import?: string }).import ?? String(built);
            assert.equal(
                target.replace('./dist/esm/', '').replace('.js', ''), module,
                `${name} and its built entry name different modules`);
        }
    });
});
