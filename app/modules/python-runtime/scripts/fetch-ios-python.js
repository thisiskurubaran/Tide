// Downloads the official CPython iOS XCframework into ios/Python.xcframework.
// It is ~320 MB unpacked, so it is fetched on install instead of committed.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');

const VERSION = '3.15.2';
const SHA256 = '0f9fc7f61ceb8278a69fc7ec6089aad81789a96fa42f31cfe6d2f5f860d20a62';
const URL = `https://www.python.org/ftp/python/${VERSION}/python-${VERSION}-iOS-XCframework.tar.gz`;
// Not needed at runtime and together they are ~185 MB of the stdlib.
const STRIP = ['test', 'idlelib'];

const dest = path.join(__dirname, '..', 'ios', 'Python.xcframework');
const stamp = path.join(dest, '.tide-version');

function download(url, file) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          download(res.headers.location, file).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} failed with ${res.statusCode}`));
          return;
        }
        const out = fs.createWriteStream(file);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  if (process.platform !== 'darwin' || process.env.EAS_BUILD_PLATFORM === 'android') {
    return;
  }
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === VERSION) {
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-python-'));
  const archive = path.join(tmp, 'python.tar.gz');
  try {
    console.log(`Fetching CPython ${VERSION} for iOS`);
    await download(URL, archive);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (hash !== SHA256) {
      throw new Error(`Checksum mismatch for ${URL}: got ${hash}`);
    }
    execFileSync('tar', ['-xzf', archive, '-C', tmp, 'Python.xcframework']);
    const stdlib = path.join(tmp, 'Python.xcframework', 'lib', `python${VERSION.split('.').slice(0, 2).join('.')}`);
    for (const dir of STRIP) {
      fs.rmSync(path.join(stdlib, dir), { recursive: true, force: true });
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(path.join(tmp, 'Python.xcframework'), dest);
    fs.writeFileSync(stamp, `${VERSION}\n`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
