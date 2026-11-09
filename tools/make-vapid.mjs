// ============================================================================
// WindFoil — VAPID-Schlüsselpaar für Web Push erzeugen
// ----------------------------------------------------------------------------
// `node tools/make-vapid.mjs` hängt VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
// VAPID_SUBJECT an windfoil.env an. Vorhandene Schlüssel werden NICHT ersetzt:
// ein Wechsel macht jedes bestehende Push-Abo ungültig.
//
// Erzeugt dasselbe wie web-push --generate-vapid-keys, aber mit node:crypto —
// damit die Schlüssel schon vor dem `npm install web-push` existieren können.
// ============================================================================
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'windfoil.env');
const SUBJECT = process.argv[2] || 'mailto:boooehmemaik@gmail.com';

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function vapidKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const prv = privateKey.export({ format: 'jwk' });
  // VAPID erwartet den unkomprimierten Punkt 0x04||X||Y, nicht das JWK.
  const raw = Buffer.concat([
    Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url'),
  ]);
  if (raw.length !== 65) throw new Error(`Public Key hat ${raw.length} Bytes statt 65`);
  if (Buffer.from(prv.d, 'base64url').length !== 32) throw new Error('Private Key hat nicht 32 Bytes');
  return { publicKey: b64url(raw), privateKey: prv.d };
}

if (!existsSync(ENV_FILE)) {
  console.error(`${ENV_FILE} fehlt — bitte auf dem Server ausführen.`);
  process.exit(1);
}

let env = readFileSync(ENV_FILE, 'utf8');
if (/^VAPID_PUBLIC_KEY=/m.test(env)) {
  console.log('VAPID-Schlüssel sind bereits gesetzt — nichts geändert.');
  process.exit(0);
}

const { publicKey, privateKey } = vapidKeys();
if (!env.endsWith('\n')) env += '\n';
env += `\n# Web Push (Windalarm) — VAPID, P-256\n`
     + `VAPID_PUBLIC_KEY=${publicKey}\n`
     + `VAPID_PRIVATE_KEY=${privateKey}\n`
     + `VAPID_SUBJECT=${SUBJECT}\n`;
writeFileSync(ENV_FILE, env);

console.log(`VAPID-Schlüssel in ${ENV_FILE} geschrieben.`);
console.log(`  public  ${publicKey.length} Zeichen`);
console.log(`  private ${privateKey.length} Zeichen (geheim halten)`);
console.log('Danach: systemctl restart windfoil-proxy');
