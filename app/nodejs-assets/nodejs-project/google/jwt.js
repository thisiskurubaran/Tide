// @ts-check
// tide:google-jwt — signs the JWT a Google service account exchanges for an
// access token (RS256). The app can't sign RSA itself; Node's crypto can.
//
//   TIDE_GOOGLE (env, JSON): { client_email, private_key, scope }
//   prints the signed JWT. The key is only in this worker's environment.
'use strict';

const crypto = require('crypto');

const { client_email: email, private_key: key, scope } = JSON.parse(process.env.TIDE_GOOGLE || '{}');
if (!email || !key) {
  process.stderr.write('The service account key needs client_email and private_key.\n');
  process.exit(1);
}

const b64url = (/** @type {Buffer | string} */ v) => Buffer.from(v).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
const claims = b64url(JSON.stringify({ iss: email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
try {
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key);
  process.stdout.write(`${header}.${claims}.${b64url(signature)}`);
} catch (e) {
  process.stderr.write(`The service account's private key couldn't be used: ${/** @type {Error} */ (e).message}\n`);
  process.exit(1);
}
