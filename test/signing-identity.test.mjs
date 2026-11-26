import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSigningIdentity } from '../scripts/signing-identity.mjs';
const first = 'A'.repeat(40), second = 'B'.repeat(40);
test('local signing selects one persistent certificate even when repeated in valid identities', () => {
  const listing = `1) ${first} "Stella Local Development" (CSSMERR_TP_NOT_TRUSTED)\n1) ${first} "Stella Local Development"`;
  assert.equal(selectSigningIdentity(listing), first);
  assert.equal(selectSigningIdentity(listing, first.toLowerCase()), first);
});
test('missing, ambiguous and ad-hoc identities fail instead of silently resetting permissions', () => {
  assert.throws(() => selectSigningIdentity('0 identities found'), /will not fall back/);
  assert.throws(() => selectSigningIdentity(`1) ${first} "Stella Local Development"\n2) ${second} "Stella Local Development"`), /found 2/);
  assert.throws(() => selectSigningIdentity('', '-'), /Ad-hoc signing/);
});

test('an Apple Development certificate is preferred, since it carries the Team ID', async () => {
  const { preferredIdentity } = await import('../scripts/signing-identity.mjs');
  const a = 'A'.repeat(40), b = 'B'.repeat(40);
  const both = `Policy: Code Signing\n  Matching identities\n  1) ${a} "Apple Development: someone@example.com (J734XFZSZ9)"\n  2) ${b} "Stella Local Development" (CSSMERR_TP_NOT_TRUSTED)\n     2 identities found\n\n  Valid identities only\n  1) ${a} "Apple Development: someone@example.com (J734XFZSZ9)"\n     1 valid identities found`;
  assert.equal(preferredIdentity(both), 'Apple Development: someone@example.com (J734XFZSZ9)');
  assert.equal(preferredIdentity(`  1) ${b} "Stella Local Development"`), 'Stella Local Development');
  assert.equal(preferredIdentity(`  1) ${a} "Apple Development: one (X)"\n  2) ${b} "Apple Development: two (Y)"`), 'Stella Local Development', 'two to choose from is ambiguous');
});

test('a Developer ID certificate comes first, since only it can be hardened and notarized', async () => {
  const { preferredIdentity, identityName, isDeveloperID, selectSigningIdentity: select } = await import('../scripts/signing-identity.mjs');
  const a = 'A'.repeat(40), b = 'B'.repeat(40), c = 'C'.repeat(40);
  const development = 'Apple Development: someone@example.com (J734XFZSZ9)', developer = 'Developer ID Application: SOME ONE (C63K728GC6)';
  const listing = `  1) ${a} "${development}"\n  2) ${b} "${developer}"\n     2 valid identities found`;
  assert.equal(preferredIdentity(listing), developer);
  assert.equal(identityName(listing, select(listing, preferredIdentity(listing)).toLowerCase()), developer);
  assert.equal(isDeveloperID(developer), true);
  assert.equal(isDeveloperID(development), false);
  assert.equal(isDeveloperID('Stella Local Development'), false);
  assert.equal(identityName(listing, c), '', 'a fingerprint that isn’t listed has no name');
  // A revoked or expired Developer ID is passed over, and two of them are ambiguous, so the next kind is used.
  assert.equal(preferredIdentity(`  1) ${a} "${development}"\n  2) ${b} "${developer}" (CSSMERR_TP_CERT_REVOKED)`), development);
  assert.equal(preferredIdentity(`  1) ${a} "${development}"\n  2) ${b} "${developer}"\n  3) ${c} "Developer ID Application: OTHER (ZZZZZZZZZZ)"`), development);
  // An installer certificate isn't one that signs apps.
  assert.equal(preferredIdentity(`  1) ${b} "Developer ID Installer: SOME ONE (C63K728GC6)"`), 'Stella Local Development');
});
