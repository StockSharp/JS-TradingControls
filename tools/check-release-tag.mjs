// What has to be true before this package may be published.
//
// Two independent things, both of which npm itself will happily let through:
//
//   1. The tag being released names the version being released. A tag that
//      disagrees with package.json produces a GitHub Release pointing at a
//      commit whose package is a different version.
//   2. No dependency is a local path. `file:../Grids` resolves on the machine
//      that has the sibling checked out and means nothing at all on a registry:
//      npm records the string verbatim, publish succeeds, and the failure is
//      an adopter's `npm install` resolving a path that does not exist on their
//      disk. It cannot be caught by any test here, because on this machine the
//      path is real -- which is exactly why it is checked at the release gate.
import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
const failures = [];

// --- 1. the tag names the version ------------------------------------------

if (typeof tag !== 'string' || tag.length === 0) {
    failures.push('Release tag is required: npm run release:check -- v<package-version>');
} else {
    const expected = `v${packageJson.version}`;
    if (tag !== expected)
        failures.push(`Release tag ${tag} does not match package version ${packageJson.version}; expected ${expected}.`);
}

if (packageJson.private === true)
    failures.push('package.json still has private=true; npm would refuse publication.');

// --- 2. nothing depends on a path -------------------------------------------

// Every map a consumer's install resolves, plus devDependencies: a local path
// there does not reach an adopter, but it does mean this repository cannot be
// built from a registry checkout, and the two mistakes look identical.
for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(packageJson[field] ?? {})) {
        if (!isLocalPath(spec)) continue;
        failures.push(
            `${field}.${name} is "${spec}", a local path. Publish the dependency and depend on a version range instead.`,
        );
    }
}

if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
} else {
    console.log(`${packageJson.name}@${packageJson.version} matches release tag ${tag}, and depends on no local path.`);
}

/// The spellings npm resolves against the filesystem rather than the registry.
/// The bare relative forms count: npm rewrites `"../Grids"` to `file:../Grids`
/// on install, so a package.json can carry either.
function isLocalPath(spec) {
    if (typeof spec !== 'string') return false;
    return /^(file|link|portal):/.test(spec)
        || /^\.{1,2}[/\\]/.test(spec)
        || /^[/\\]/.test(spec)
        || /^[A-Za-z]:[/\\]/.test(spec);
}
