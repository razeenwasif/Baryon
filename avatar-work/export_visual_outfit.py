from pathlib import Path
import bpy
OUT=Path('/Users/razeenwasif/Stella/avatar-work/mavuika/outfits/lab-coat')
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
# Snapshot/export the bind pose without including the viewport reference.
pose={b.name:b.matrix_basis.copy() for b in arm.pose.bones}
was_hidden=arm.hide_get();arm.hide_set(False)
for b in arm.pose.bones:b.matrix_basis.identity()
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
 if o==arm or o.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in o.modifiers):o.hide_set(False);o.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'stella-visual-tailoring.blend'))
old=arm.data.pose_position;arm.data.pose_position='REST';bpy.context.view_layer.update()
try:
 result=bpy.ops.export_scene.vrm(filepath=str(OUT/'stella-visual-tailoring.vrm'),armature_object_name=arm.name,export_only_selections=True,export_invisibles=True,export_all_influences=True,ignore_warning=True)
 assert result=={'FINISHED'}
finally:
 arm.data.pose_position=old
 for b in arm.pose.bones:b.matrix_basis=pose[b.name]
 arm.hide_set(was_hidden);bpy.context.view_layer.update()
# glTF's exporter does not retain this RGB multiply node's constant tint.
# Encode the same linear color explicitly in the standard baseColorFactor.
import json,struct
file=OUT/'stella-visual-tailoring.vrm';data=file.read_bytes()
jlen=struct.unpack_from('<I',data,12)[0];gltf=json.loads(data[20:20+jlen])
for mat in gltf['materials']:
 if mat['name'].startswith('Stella •') and 'VRMC_materials_mtoon' not in mat.get('extensions',{}):
  mat.get('extensions',{}).pop('KHR_materials_sheen',None)
  if 'knit' in mat['name']:mat['emissiveFactor']=[.045,.007,.002]
  elif 'cotton' in mat['name']:mat['emissiveFactor']=[.085,.078,.07]
 if mat['name'].startswith('Stella •') and 'knit' in mat['name']:
  mat.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=[.40,.065,.022,1]
encoded=json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode('utf8')
encoded+=b' '*((-len(encoded))%4)
tail=data[20+jlen:]
file.write_bytes(struct.pack('<III',0x46546C67,2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('VISUAL_OUTFIT_EXPORTED')
