from pathlib import Path
import sys, json, math
import bpy
from mathutils import Quaternion, Vector
root=Path(__file__).resolve().parent
sys.path.insert(0,str(root/'tools'))
sys.path.insert(0,str(root/'tools/vendor'))
import vrm_addon
import mmd_tools
vrm_addon.register()
mmd_tools.register()
print('STELLA_TOOLS', bpy.app.version_string, vrm_addon.bl_info['version'])
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC'
references=bpy.data.collections.new('Mavuika • supplied references')
scene.collection.children.link(references)
for name, file, x, scale in [
 ('01 • Full outfit','3e93ea2c75601a2434ee6745429bef60.jpg',-2.0,2.7),
 ('02 • Face and collar','8d6db61b440338a14aac18dc7a65d52f.jpg',0,1.8),
 ('03 • Front, back and sides','e952d8155472025f6b90a8df20e29978.jpg',2.7,3.3)]:
 image=bpy.data.images.load(str(root/'mavuika/references'/file)); image.pack()
 obj=bpy.data.objects.new(name,None);references.objects.link(obj)
 obj.empty_display_type='IMAGE'; obj.data=image; obj.empty_display_size=scale
 obj.rotation_euler=(math.pi/2,0,0);obj.location=(x,1,1.35)
 obj.color[3]=.85;obj.hide_render=True
notes=bpy.data.texts.new('READ ME • Mavuika conversion')
notes.write('Target: close match to supplied Mavuika references.\nSource: https://aplaybox.com/details/model/UGujbE7o5fxR\nModel credit: miHoYo / Guanhai (观海).\nThis is a preparation scene, not a finished avatar.\nOriginal Stella model and installed app are unchanged.\nVRM and MMD tools are staged project-locally in ../tools.\n')
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   space=area.spaces.active; space.region_3d.view_distance=6
   space.region_3d.view_location=Vector((.5,1,1.35))
   space.region_3d.view_rotation=Quaternion((1,0,0),math.pi/2)
   space.region_3d.view_perspective='ORTHO'
bpy.ops.wm.save_as_mainfile(filepath=str(root/'mavuika/mavuika-workbench.blend'))
print('STELLA_WORKBENCH_SAVED')
