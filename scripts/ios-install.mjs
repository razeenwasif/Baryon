// Builds the iPhone app and installs it on a connected device. The Apple Developer membership signs it for a year,
// so run this again before then, or whenever the app changes. What the app has saved stays.
// Run: npm run ios:install (add a device's name to choose one, such as: npm run ios:install -- "My iPhone")
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ios = fileURLToPath(new URL('../ios/', import.meta.url)), wanted = process.argv[2];
function devices() {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-devices-')), file = join(dir, 'devices.json');
  try {
    execFileSync('xcrun', ['devicectl', 'list', 'devices', '--quiet', '--json-output', file], { stdio: 'ignore' });
    return JSON.parse(readFileSync(file, 'utf8')).result.devices;
  } finally { rmSync(dir, { recursive: true }); }
}
const name = device => device.deviceProperties?.name ?? device.identifier, kind = device => device.hardwareProperties?.deviceType ?? '';
// A running Simulator is listed here too, and has an iPhone's type and platform.
const found = devices().filter(device => device.hardwareProperties?.platform === 'iOS' && device.visibilityClass !== 'simulators');
const device = wanted ? found.find(item => name(item) === wanted) : found.find(item => kind(item) === 'iPhone');
const stop = words => { console.error(words); process.exit(1); };
if (!device) stop(`${wanted ? `Couldn’t find ${wanted}.` : 'Couldn’t find an iPhone. Connect it, unlock it and tap Trust.'}${found.length ? `\nDevices this Mac knows: ${found.map(name).join(', ')}` : ''}`);
// A device the Mac once paired with stays listed after it's gone.
if (device.connectionProperties?.tunnelState === 'unavailable') stop(`${name(device)} isn’t connected to this Mac right now. Connect it with a cable, unlock it and tap Trust if it asks.\nIf this keeps happening, turn on Developer Mode in Settings, Privacy & Security, let it restart, then try again.`);
console.log(`Building for ${name(device)}…`);
try {
  // Asking for this device, not any iOS device, is what registers a new one with the account.
  execFileSync('xcodebuild', ['-project', 'Fairy.xcodeproj', '-scheme', 'Fairy', '-destination', `id=${device.hardwareProperties.udid}`, '-configuration', 'Debug', '-derivedDataPath', 'build', '-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration', '-quiet', 'build'], { cwd: ios, stdio: ['ignore', 'inherit', 'inherit'] });
  execFileSync('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.identifier, join(ios, 'build/Build/Products/Debug-iphoneos/Fairy.app')], { stdio: 'inherit' });
} catch { stop(`Couldn’t install on ${name(device)}. The reason is above.`); }
console.log(`Installed on ${name(device)}. The first time, trust your developer profile in Settings, General, VPN & Device Management.`);
