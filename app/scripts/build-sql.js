// Bundles the database drivers into the nodejs-mobile project, which has no
// node_modules of its own. All are plain JavaScript over Node's net and tls.
//   sql/drivers.js    Postgres (pg) and MySQL (mysql2). pg's optional native
//                     binding and its Cloudflare Workers socket stay out.
//   mongo/driver.js   MongoDB (mongodb 6, the last line for Node 18). Its
//                     optional native compressors, Kerberos, client-side
//                     encryption and cloud auth helpers stay out; the driver
//                     works without them.
// Redis needs no driver: redis/resp.js speaks the protocol itself.
// The output is committed, like the other bundles; rerun after upgrading them.
const path = require('path');
const esbuild = require('esbuild');

const project = path.join(__dirname, '..', 'nodejs-assets', 'nodejs-project');

const bundle = (contents, out, external) =>
  esbuild
    .build({
      stdin: { contents, resolveDir: path.join(__dirname, '..'), loader: 'js' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      // nodejs-mobile is Node 18.
      target: 'node18',
      minify: true,
      legalComments: 'inline',
      external,
      outfile: path.join(project, out),
      logLevel: 'warning',
    })
    .then(() => console.log(`wrote ${path.relative(process.cwd(), path.join(project, out))}`));

Promise.all([
  bundle("module.exports = { pg: require('pg'), mysql: require('mysql2/promise') };", 'sql/drivers.js', ['pg-native', 'cloudflare:sockets', 'pg-cloudflare']),
  bundle("const m = require('mongodb'); module.exports = { MongoClient: m.MongoClient, EJSON: m.BSON.EJSON };", 'mongo/driver.js', [
    'kerberos',
    'snappy',
    '@mongodb-js/zstd',
    'mongodb-client-encryption',
    '@aws-sdk/credential-providers',
    'gcp-metadata',
    'socks',
    'aws4',
  ]),
]).catch(() => process.exit(1));
