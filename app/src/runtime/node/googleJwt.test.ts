/**
 * @jest-environment node
 */
/// <reference types="node" />
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import path from 'path';

const CLI = path.join(__dirname, '../../../nodejs-assets/nodejs-project/google/jwt.js');

describe('tide:google-jwt', () => {
  it('signs a service account JWT that verifies with the public key', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const r = spawnSync(process.execPath, [CLI], {
      env: { ...process.env, TIDE_GOOGLE: JSON.stringify({ client_email: 'deploy@proj.iam.gserviceaccount.com', private_key: pem, scope: 'https://www.googleapis.com/auth/firebase.hosting' }) },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const [h, c, s] = r.stdout.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
    expect(claims).toMatchObject({ iss: 'deploy@proj.iam.gserviceaccount.com', aud: 'https://oauth2.googleapis.com/token', scope: 'https://www.googleapis.com/auth/firebase.hosting' });
    expect(claims.exp - claims.iat).toBe(3600);
    expect(crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true);
  });

  it('explains a broken key', () => {
    const r = spawnSync(process.execPath, [CLI], { env: { ...process.env, TIDE_GOOGLE: JSON.stringify({ client_email: 'a@b', private_key: 'nope' }) }, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("private key couldn't be used");
  });
});
