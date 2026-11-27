export function selectSigningIdentity(output, requested = 'Stella Local Development') {
  if (requested === '-') throw new Error('Ad-hoc signing changes Fairy’s privacy identity on rebuild. Choose a persistent code-signing certificate.');
  const identities = new Map();
  for (const match of output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/gm)) {
    if (match[2] === requested || match[1].toLowerCase() === requested.toLowerCase()) identities.set(match[1].toUpperCase(), match[2]);
  }
  if (identities.size !== 1) throw new Error(`Expected one signing identity named "${requested}", found ${identities.size}. Create a Code Signing certificate in Keychain Access, or set STELLA_SIGN_IDENTITY to its certificate fingerprint. The build will not fall back to ad-hoc signing.`);
  return identities.keys().next().value;
}

// The identity to sign with when none is named. First your Developer ID Application certificate, when this Mac has
// exactly one: it's the only kind Apple will notarize, and the only one a hardened Fairy is built with. Then your Apple
// Development certificate, when there's exactly one. Both carry your Team ID, so macOS trusts Fairy as your team's app
// (the Keychain's partition is "teamid:…") and a new build doesn't ask for the Keychain again, as it did when the
// self-signed certificate made every build's fingerprint (cdhash) a stranger. Otherwise the shared local certificate.
export function preferredIdentity(output) {
  // `security` lists every identity, with a note after the name of one it won't trust, and then the valid ones again.
  // One noted as revoked, expired or untrusted anywhere is out.
  const listed = [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"(.*)$/gm)].map(match => ({ print: match[1].toUpperCase(), name: match[2], note: match[3] }));
  const refused = new Set(listed.filter(entry => /CSSMERR|REVOKED|EXPIRED/i.test(entry.note)).map(entry => entry.print));
  for (const kind of [/^Developer ID Application: /, /^Apple Development: /]) {
    const names = new Map(listed.filter(entry => kind.test(entry.name) && !refused.has(entry.print)).map(entry => [entry.print, entry.name]));
    if (names.size === 1) return names.values().next().value;
  }
  return 'Stella Local Development';
}

// The name of the identity with this fingerprint, as `security find-identity` lists it; '' when it isn't there.
export function identityName(output, fingerprint) {
  for (const match of output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/gm)) if (match[1].toUpperCase() === String(fingerprint).toUpperCase()) return match[2];
  return '';
}

// Only a Developer ID build gets the hardened runtime and a timestamp from Apple. The self-signed certificate has no
// Team ID, and the hardened runtime would then refuse to load Fairy's own native modules, which it checks by team.
export const isDeveloperID = name => /^Developer ID Application: /.test(String(name));
