import bpy,json,math
from pathlib import Path
from mathutils import Matrix,Quaternion
OUT=Path('/Users/razeenwasif/Stella/avatar-work/mavuika/outfits/lab-coat')
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
deltas=json.loads((OUT/'visual-check/crossed-bone-deltas.json').read_text())
C=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
Ci=C.inverted()
mapping=arm.data.vrm_addon_extension.vrm1.humanoid.human_bones.human_bone_name_to_human_bone()
targets={}
for b in arm.pose.bones:b.matrix_basis.identity()
bpy.context.view_layer.update()
for name,record in mapping.items():
 key=name.value if hasattr(name,'value') else str(name)
 if key in deltas:
  a=deltas[key];dg=Matrix(tuple(tuple(a[j*4+i] for j in range(4)) for i in range(4)))
  bone=arm.pose.bones.get(record.node.bone_name)
  if bone:targets[bone.name]=Ci@dg@C@bone.bone.matrix_local
for bone in sorted(arm.pose.bones,key=lambda b:len(b.parent_recursive)):
 if bone.name in targets:
  bone.matrix=targets[bone.name]
  bpy.context.view_layer.update()
arm.data.pose_position='POSE';bpy.context.view_layer.update()
for obj in bpy.context.scene.objects:
 if obj.type=='MESH':obj.show_wire=False;obj.show_all_edges=False;obj.display_type='TEXTURED'

# Reference beside the model, available as a viewport-only image.
ref=bpy.data.objects.get('Approved outfit reference')
if not ref:
 ref=bpy.data.objects.new('Approved outfit reference',None);bpy.context.collection.objects.link(ref)
 ref.empty_display_type='IMAGE';ref.data=bpy.data.images.load(str(OUT/'concept-v1.png'),check_existing=True)
ref.empty_display_size=.68;ref.location=(.63,.15,1.43);ref.rotation_euler=(math.pi/2,0,0);ref.hide_render=True;ref.show_in_front=True;ref.empty_image_depth='FRONT'
# Include the current 3D space even while the Python console is active.
for screen in bpy.data.screens:
 for area in screen.areas:
  for space in area.spaces:
   if space.type=='VIEW_3D':
    space.overlay.show_overlays=True;space.overlay.show_wireframes=False;space.overlay.show_bones=False;space.overlay.show_relationship_lines=False;space.overlay.show_floor=False;space.overlay.show_axis_x=False;space.overlay.show_axis_y=False;space.shading.type='MATERIAL'
    arm.hide_set(True)
    space.region_3d.view_rotation=Quaternion((1,0,0),math.pi/2)
    space.region_3d.view_perspective='ORTHO';space.region_3d.view_location=(.29,0,1.42);space.region_3d.view_distance=1.6
print('CROSSED_POSE_READY',len(targets))
