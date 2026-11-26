from pathlib import Path
import sys
import bpy, addon_utils
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'tools'))
sys.path.insert(0,str(ROOT/'tools/vendor'))
def enable_tools():
    for name in ['vrm_addon','mmd_tools']:
        addon_utils.enable(name,default_set=True,persistent=True)
        assert name in bpy.context.preferences.addons, f'{name} did not enable'
