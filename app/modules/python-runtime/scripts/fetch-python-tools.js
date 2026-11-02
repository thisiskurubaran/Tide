// Downloads the pure-Python tools Format & Lint uses into python/, next to
// tide_runner.py, so they ship with the app on both platforms: pyflakes for
// warnings, autopep8 (with pycodestyle) for formatting, and jedi (with parso)
// for Python IntelliSense. All MIT licensed.
// Fetched on install like the iOS framework; each wheel is checksum-pinned.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { entries } = require('../../../nodejs-assets/nodejs-project/pip/zip');

const WHEELS = [
  {
    url: 'https://files.pythonhosted.org/packages/fd/52/98c9a0e4718abe887121279457bc7140115df22d714b7183880eb61e359f/pyflakes-4.1.0-py2.py3-none-any.whl',
    sha256: 'b2e05e6bac8e49b67be2a6ffa63422c60f7193fc72e8180255907b41ec997dc1',
  },
  {
    url: 'https://files.pythonhosted.org/packages/9e/43/53afb8ba17218f19b77c7834128566c5bbb100a0ad9ba2e8e89d089d7079/autopep8-2.3.2-py2.py3-none-any.whl',
    sha256: 'ce8ad498672c845a0c3de2629c15b635ec2b05ef8177a6e7c91c74f3e9b51128',
  },
  {
    url: 'https://files.pythonhosted.org/packages/56/e2/480bcdb153feecde4d736b18c908c7eee4846f11d7547d2e0c71499af630/pycodestyle-2.15.0-py2.py3-none-any.whl',
    sha256: '12fd2f73c7b8ee8845a0431111df8faf4c1a07d6e64e2ee7f0c74014dab14181',
  },
  {
    url: 'https://files.pythonhosted.org/packages/be/c7/71eb0d51cdcbb63b857c931aa4e9218b078b5d9f8ecd383b234f28fe7b0f/jedi-0.20.1-py2.py3-none-any.whl',
    sha256: '0fb16d86c4a4c73c37ba518c77419975e30fcc620658a8d14fbb5720cdd34142',
  },
  {
    url: 'https://files.pythonhosted.org/packages/99/5d/8268b644392ee874ee82a635cd0df1773de230bde356c38de28e298392cc/parso-0.8.7-py2.py3-none-any.whl',
    sha256: 'a8926eb2a1b915486941fdbd31e86a4baf88fe8c210f25f2f35ecec5b574ca1c',
  },
];

// Typeshed's third-party stubs (~10 MB) and Django's are left out: packages from
// pip are read from .pylibs as source instead. The stdlib stubs stay.
const SKIP = ['jedi/third_party/typeshed/stubs/', 'jedi/third_party/django-stubs/'];

const dest = path.join(__dirname, '..', 'python');
const stamp = path.join(dest, '.tide-tools');
const version = WHEELS.map((w) => w.sha256).join('\n');

async function main() {
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === version) return;
  for (const wheel of WHEELS) {
    const res = await fetch(wheel.url);
    if (!res.ok) throw new Error(`GET ${wheel.url} failed with ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash !== wheel.sha256) throw new Error(`Checksum mismatch for ${wheel.url}: got ${hash}`);
    for (const { name, data } of entries(buf)) {
      // Code and licenses; the rest of .dist-info isn't needed at runtime.
      if (name.includes('.dist-info/') && !/LICENSE/i.test(name)) continue;
      if (name.includes('/test/') || SKIP.some((dir) => name.startsWith(dir))) continue;
      const out = path.join(dest, name);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, data);
    }
  }
  fs.writeFileSync(stamp, version);
  console.log('Fetched pyflakes, autopep8, pycodestyle, jedi and parso');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
