// Single-file bundler & safe minifier -> produces self-contained index.html
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(dir, 'src');

const modules = ['math.js', 'geom.js', 'eras_atlas.js', 'shaders.js', 'tour.js', 'audio.js', 'main.js'];

// Strip ES import/export boilerplate cleanly since all modules share one top-level module scope
function stripModuleBoilerplate(code) {
  let out = code;
  // Remove single-line and multi-line import statements
  out = out.replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  // Replace `export ` keywords cleanly
  out = out.replace(/^\s*export\s+(?=(const|let|var|function|class|async)\b)/gm, '');
  return out;
}

// Minify WGSL shader source inside backtick template literals marked with /* wgsl */
function minifyWgsl(wgsl) {
  return wgsl
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/^ +| +$/gm, '')
    .replace(/\n+/g, '\n')
    .replace(/ *([,;{}()=]) */g, '$1')
    .replace(/\)(?=[A-Za-z_])/g, ') ')
    .trim();
}

// Safe tokenizer-based JS minifier (strips comments + blank lines + leading indent; preserves strings/templates/regexes)
function minifyJs(src) {
  let out = '';
  const n = src.length;
  let i = 0;
  let inLineStart = true;

  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // Template literal (handle /* wgsl */ right before backtick, with optional space!)
    if (ch === '`') {
      const mWgsl = out.match(/\/\*wgsl\*\/\s*$/);
      const isWgsl = Boolean(mWgsl);
      if (isWgsl) out = out.slice(0, out.length - mWgsl[0].length);
      let raw = '';
      i++;
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\' && i + 1 < n) {
          raw += src[i] + src[i + 1];
          i += 2;
        } else {
          raw += src[i++];
        }
      }
      i++; // closing `
      if (isWgsl && !raw.includes('${')) {
        out += '`' + minifyWgsl(raw) + '`';
      } else {
        out += '`' + raw + '`';
      }
      inLineStart = false;
      continue;
    }

    // String literals (' or ")
    if (ch === "'" || ch === '"') {
      const q = ch;
      out += ch;
      i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\' && i + 1 < n) {
          out += src[i] + src[i + 1];
          i += 2;
        } else {
          out += src[i++];
        }
      }
      if (i < n) out += src[i++];
      inLineStart = false;
      continue;
    }

    // Preserve /* wgsl */ marker right before WGSL template literals
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const comment = end === -1 ? src.slice(i) : src.slice(i, end + 2);
      if (/\/\*\s*wgsl\s*\*\//.test(comment)) {
        out += '/*wgsl*/';
      }
      i = end === -1 ? n : end + 2;
      continue;
    }

    // Single-line comment
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }

    // Collapse newlines & leading indentation safely (preserves JS ASI!)
    if (ch === '\n' || ch === '\r') {
      if (!inLineStart && !out.endsWith('\n')) out += '\n';
      inLineStart = true;
      i++;
      continue;
    }

    if (ch === ' ' || ch === '\t') {
      if (inLineStart) { i++; continue; }
      // Collapse consecutive spaces
      if (!out.endsWith(' ') && !out.endsWith('\n')) out += ' ';
      i++;
      continue;
    }

    out += ch;
    inLineStart = false;
    i++;
  }

  // Strip trailing spaces before newlines & empty lines
  return out
    .replace(/ +\n/g, '\n')
    .replace(/\n+/g, '\n')
    .trim();
}

const rawJs = modules.map((f) => stripModuleBoilerplate(fs.readFileSync(path.join(srcDir, f), 'utf8'))).join('\n');
const minJs = minifyJs(rawJs);
const css = fs.readFileSync(path.join(srcDir, 'style.css'), 'utf8').trim();
const tpl = fs.readFileSync(path.join(srcDir, 'template.html'), 'utf8');

const html = tpl
  .replace('/*__CSS__*/', css)
  .replace('/*__JS__*/', minJs)
  .replace(/\n\s+</g, '\n<');

const outPath = path.join(dir, 'index.html');
fs.writeFileSync(outPath, html, 'utf8');

// Quick syntax check of bundled JS using Node's Function/module parser!
const tmpCheck = path.join(dir, '.bundle-check.mjs');
fs.writeFileSync(tmpCheck, minJs, 'utf8');
try {
  // Parse check only (do not execute DOM code)
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--check', tmpCheck], { stdio: 'pipe' });
  fs.unlinkSync(tmpCheck);
} catch (err) {
  console.error('JS SYNTAX CHECK FAILED:', err.stderr?.toString() || err.message);
  process.exit(1);
}

const rawBytes = Buffer.byteLength(rawJs) + Buffer.byteLength(css) + Buffer.byteLength(tpl);
const outBytes = Buffer.byteLength(html);
console.log(`Built ${outPath}`);
console.log(`  Raw source : ${(rawBytes / 1024).toFixed(2)} KB (${rawBytes} B)`);
console.log(`  Minified   : ${(outBytes / 1024).toFixed(2)} KB (${outBytes} B)`);
