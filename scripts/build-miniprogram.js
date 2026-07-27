import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceFiles = [
  ['src/domain/budget.js', 'miniprogram/lib/domain/budget.js'],
  ['src/domain/ledger.js', 'miniprogram/lib/domain/ledger.js'],
  ['src/domain/storage.js', 'miniprogram/lib/domain/storage.js'],
  ['src/application/app-core.js', 'miniprogram/lib/application.js'],
];

function transformEsmToCommonJs(source) {
  const exported = [];
  let transformed = source.replace(/import\s*\{([\s\S]*?)\}\s*from\s*(['"][^'"]+['"])\s*;/g, (_, names, moduleName) => {
    const bindings = names.split(',').map((rawName) => {
      const [name, alias] = rawName.trim().split(/\s+as\s+/);
      return alias ? `${name}: ${alias}` : name;
    }).filter(Boolean).join(', ');
    return `const { ${bindings} } = require(${moduleName});`;
  });
  transformed = transformed.replace(/export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/g, (_, asyncKeyword = '', name) => {
    exported.push(name);
    return `${asyncKeyword || ''}function ${name}`;
  });
  transformed = transformed.replace(/export\s+const\s+([A-Za-z_$][\w$]*)/g, (_, name) => {
    exported.push(name);
    return `const ${name}`;
  });
  transformed = transformed.replace(/export\s*\{([^}]+)\}\s*;/g, (_, names) => {
    for (const rawName of names.split(',')) {
      const [name, alias] = rawName.trim().split(/\s+as\s+/);
      if (name) exported.push(`${name}: ${alias || name}`);
    }
    return '';
  });
  const uniqueExports = [...new Set(exported)];
  return `${transformed}\nmodule.exports = { ${uniqueExports.join(', ')} };\n`;
}

export function generatedOutputs() {
  const outputs = new Map();
  for (const [sourceRelative, outputRelative] of sourceFiles) {
    const source = fs.readFileSync(path.join(root, sourceRelative), 'utf8');
    const transformed = transformEsmToCommonJs(source).replaceAll("require('../domain/", "require('./domain/");
    outputs.set(outputRelative, `// GENERATED FILE. Run npm run build:mini.\n${transformed}`);
  }
  const manifest = {
    generatedBy: 'scripts/build-miniprogram.js',
    sources: Object.fromEntries(sourceFiles.map(([sourceRelative]) => {
      const content = fs.readFileSync(path.join(root, sourceRelative));
      return [sourceRelative, crypto.createHash('sha256').update(content).digest('hex')];
    })),
  };
  outputs.set('miniprogram/lib/build-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return outputs;
}

export function build() {
  const outputs = generatedOutputs();
  for (const [relative, content] of outputs) {
    const fullPath = path.join(root, relative);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf8');
  }
  console.log(`MINIPROGRAM BUILD PASSED: ${outputs.size} generated files`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) build();
