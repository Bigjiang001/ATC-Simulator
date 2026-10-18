// Run locally with Application Default Credentials; never include these credentials in the site.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const [projectId, uid, action] = process.argv.slice(2);
if (!projectId || !uid || !['grant', 'revoke'].includes(action)) {
  console.error('Usage: node firebase/functions/set-admin.cjs PROJECT_ID UID grant|revoke'); process.exit(1);
}
initializeApp({ credential: applicationDefault(), projectId });
(async () => {
  const auth = getAuth(), user = await auth.getUser(uid), claims = { ...user.customClaims };
  if (action === 'grant') claims.admin = true;
  else delete claims.admin;
  await auth.setCustomUserClaims(uid, claims);
  if (action === 'revoke') await auth.revokeRefreshTokens(uid);
  console.log(`Administrator access ${action === 'grant' ? 'granted' : 'revoked'} for ${uid}. Sign in again.`);
})().catch(error => { console.error(error.message); process.exitCode = 1; });
