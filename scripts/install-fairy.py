"""Install the signed Baryon bundle without changing legacy data/Keychain identity."""
from pathlib import Path
import subprocess, shutil, time, os, signal, plistlib
root=Path(__file__).resolve().parent.parent
source=root/'release/Baryon-darwin-arm64/Baryon.app'
target=Path.home()/'Applications/Baryon.app'
legacies=[Path.home()/'Applications'/name for name in ['Fairy.app','Robin.app','Lyra.app']]
old=next((p for p in [target,*legacies] if p.exists()),target)
backup=root/'.local-data/app-backups'/('Companion-before-baryon-'+time.strftime('%Y%m%d-%H%M%S')+'.app')
def requirement(path):
    p=subprocess.run(['codesign','-d','-r-',str(path)],capture_output=True,text=True,check=True)
    return next(l for l in (p.stdout+p.stderr).splitlines() if l.startswith('designated =>'))
def bundle_id(path):
    with (path/'Contents/Info.plist').open('rb') as f:return plistlib.load(f)['CFBundleIdentifier']
assert source.exists(), 'Build Baryon first'
assert bundle_id(source)=='dev.razeen.lyra'
with (source/'Contents/Info.plist').open('rb') as f:info=plistlib.load(f)
assert info['CFBundleDisplayName']=='Baryon' and info['CFBundleExecutable']=='Baryon', 'Incomplete Baryon branding'
assert (source/'Contents/Resources'/info['CFBundleIconFile']).is_file(), 'Missing app icon'
if old.exists():
    assert bundle_id(old)=='dev.razeen.lyra', 'Destination is a different application'
    # A new identity is refused, except a deliberate move to a team certificate (FAIRY_NEW_IDENTITY=1), which macOS then
    # trusts across builds; permissions and the Keychain are granted again once after it.
    if requirement(source)!=requirement(old):
        assert os.environ.get('FAIRY_NEW_IDENTITY')=='1' and 'anchor apple generic' in requirement(source), 'Signing identity changed (FAIRY_NEW_IDENTITY=1 switches to a team certificate on purpose)'
subprocess.run(['codesign','--verify','--deep','--strict',str(source)],check=True)
# Gracefully stop only this app's installed main processes; its normal quit flushes data.
patterns=[f'^{p}/Contents/MacOS/{exe}$' for p in [target,*legacies] for exe in ['Baryon','Fairy','Robin','Lyra']]
for pattern in patterns:
    for pid in subprocess.run(['pgrep','-f',pattern],capture_output=True,text=True).stdout.split():os.kill(int(pid),signal.SIGTERM)
for _ in range(80):
    if all(subprocess.run(['pgrep','-f',p],capture_output=True).returncode!=0 for p in patterns):break
    time.sleep(.25)
else:raise RuntimeError('The running app did not quit; nothing replaced')
backup.parent.mkdir(parents=True,exist_ok=True)
if old.exists():shutil.move(str(old),str(backup))
try:
    shutil.copytree(source,target,symlinks=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(target)],check=True)
except Exception:
    if target.exists():shutil.rmtree(target)
    if backup.exists():shutil.move(str(backup),str(old))
    raise
subprocess.run(['open','-a',str(target)],check=True)
# The drop folder's tools for the Claude app's daily task (claude.ai Docs and Designs, claude-sync.mjs): kept current here.
tools=Path.home()/'Library/Application Support/lyra-companion/face/claude-sync-drop/_tools'
tools.mkdir(parents=True,exist_ok=True)
for path in [root/'scripts/claude-drop/claude-drop.py',root/'scripts/claude-drop/export-docs.mjs',root/'desktop/doc-export.mjs']:shutil.copyfile(path,tools/path.name)
# Symlink `baryon`, `baryon-mcp`, `fairy`, and `fairy-mcp` CLIs into ~/.local/bin so terminal commands resolve on PATH.
for link_name, bin_name in [('baryon', 'baryon'), ('baryon-mcp', 'baryon-mcp'), ('fairy', 'fairy'), ('fairy-mcp', 'fairy-mcp')]:
    cli_src=root/'bin'/bin_name
    if cli_src.exists():
        try:
            cli_src.chmod(cli_src.stat().st_mode | 0o111)
            cli_dst=Path.home()/'.local/bin'/link_name
            cli_dst.parent.mkdir(parents=True,exist_ok=True)
            if cli_dst.is_symlink() or cli_dst.exists():cli_dst.unlink()
            cli_dst.symlink_to(cli_src)
        except Exception as exc:
            print('CLI symlink skipped:', link_name, exc)
print('Installed:',target,'Backup:',backup)
