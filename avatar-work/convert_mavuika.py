"""Reproducible personal VRM conversion; retains the complete source character."""
from pathlib import Path
import sys, json
import bpy
from mathutils import Vector, Matrix
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from blender_bootstrap import enable_tools
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'mavuika/mavuika-source.blend'))
enable_tools()
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = arm
for pb in arm.pose.bones:
    for c in list(pb.constraints): pb.constraints.remove(c)
    pb.matrix_basis = Matrix.Identity(4)
arm.animation_data_clear()
if mesh.data.shape_keys:
    mesh.data.shape_keys.animation_data_clear()
    for key in mesh.data.shape_keys.key_blocks: key.value = 0
bpy.context.view_layer.update()

# Straighten the original A-pose into a VRM T-pose. Bake the exact same
# skinning transform into every expression, preserving facial morph deltas.
for side, sign in [('左', 1), ('右', -1)]:
    for suffix in ['腕', 'ひじ', '手首']:
        pb = arm.pose.bones[side + suffix]
        direction = (pb.tail - pb.head).normalized()
        q = direction.rotation_difference(Vector((sign, 0, 0)))
        pivot = pb.head.copy()
        pb.matrix = Matrix.Translation(pivot) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pivot) @ pb.matrix
        bpy.context.view_layer.update()
transforms = {b.name: b.matrix @ b.bone.matrix_local.inverted() for b in arm.pose.bones}
group_names = {g.index: g.name for g in mesh.vertex_groups}
vertex_matrices = []
for v in mesh.data.vertices:
    influences = [(transforms[group_names[g.group]], g.weight) for g in v.groups if group_names[g.group] in transforms and g.weight > 0]
    total = sum(w for _, w in influences)
    mat = Matrix.Identity(4) if not total else sum((m * (w / total) for m, w in influences), Matrix(((0,)*4,)*4))
    vertex_matrices.append(mat)
for key in mesh.data.shape_keys.key_blocks:
    for p, mat in zip(key.data, vertex_matrices): p.co = mat @ p.co
for v, p in zip(mesh.data.vertices, mesh.data.shape_keys.key_blocks[0].data): v.co = p.co
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')

ext = arm.data.vrm_addon_extension
ext.spec_version = '1.0'
mapping = {'hips':'腰', 'spine':'上半身', 'chest':'上半身1', 'upper_chest':'上半身2', 'neck':'首', 'head':'頭', 'left_eye':'左目', 'right_eye':'右目'}
for side, jp in [('left','左'), ('right','右')]:
    for human, bone in [('shoulder','肩'), ('upper_arm','腕'), ('lower_arm','ひじ'), ('hand','手首'), ('upper_leg','足D'), ('lower_leg','ひざD'), ('foot','足首D'), ('toes','足先EX')]: mapping[side+'_'+human] = jp+bone
    for finger, bone in [('thumb','親指'),('index','人指'),('middle','中指'),('ring','薬指'),('little','小指')]:
        for segment, number in ( [('metacarpal','０'),('proximal','１'),('distal','２')] if finger=='thumb' else [('proximal','１'),('intermediate','２'),('distal','３')] ):
            mapping[f'{side}_{finger}_{segment}'] = jp+bone+number
for human, bone in mapping.items(): getattr(ext.vrm1.humanoid.human_bones, human).node.bone_name = bone
meta = ext.vrm1.meta
meta.vrm_name = 'Mavuika — Stella personal avatar'
meta.version = '1.0'
meta.authors.clear()
for author in ['miHoYo / 原神', '观海 (PMX conversion)']: meta.authors.add().value = author
meta.copyright_information = 'Character and model © miHoYo. PMX conversion: 观海. Personal local VRM conversion for Stella.'
meta.references.add().value = 'https://aplaybox.com/details/model/UGujbE7o5fxR'
meta.third_party_licenses = (ROOT/'mavuika/source/readme【一定要看】.txt').read_text(encoding='utf-8-sig')
meta.avatar_permission = 'onlySeparatelyLicensedPerson'
meta.commercial_usage = 'personalNonProfit'
meta.credit_notation = 'required'
meta.allow_redistribution = False
meta.modification = 'allowModification'
meta.other_license_url = 'https://aplaybox.com/details/model/UGujbE7o5fxR'

for material in mesh.data.materials:
    node = material.node_tree.nodes.get('mmd_base_tex')
    texture = node.image if node else None
    hidden = material.diffuse_color[3] == 0
    material.vrm_addon_extension.mtoon1.enabled = True
    gltf = material.vrm_addon_extension.mtoon1
    gltf.pbr_metallic_roughness.base_color_factor = (1,1,1,0 if hidden else 1)
    gltf.pbr_metallic_roughness.base_color_texture.index.source = texture
    gltf.alpha_mode = 'BLEND' if hidden else 'MASK'
    gltf.alpha_cutoff = .4
    gltf.emissive_texture.index.source = texture
    gltf.emissive_factor = (.22,.22,.22)
    gltf.double_sided = True
    toon = gltf.extensions.vrmc_materials_mtoon
    toon.shade_multiply_texture.index.source = texture
    toon.shade_color_factor = (.82,.77,.78)
    toon.shading_toony_factor = .9
    toon.shading_shift_factor = -.15
    toon.gi_equalization_factor = .8
    toon.outline_width_mode = 'worldCoordinates' if material.name in ['髮','体','体2','饰'] else 'none'
    toon.outline_width_factor = .00045
    toon.outline_color_factor = (.13,.045,.035)

expressions = {
    'blink':[('まばたき',1)], 'blink_left':[('ウィンク',1)], 'blink_right':[('ウィンク右',1)],
    'aa':[('あ',1)], 'ih':[('い',1)], 'ou':[('う',1)], 'ee':[('え',1)], 'oh':[('お',1)],
    'happy':[('口角上げ',.7),('にこり',.3)], 'relaxed':[('口角上げ',.3)],
    'angry':[('怒り',.65),('怒り目',.4)], 'sad':[('困る',.65),('口角下げ',.3)], 'surprised':[('びっくり',.75),('お',.25)]
}
for name, shapes in expressions.items():
    expression = getattr(ext.vrm1.expressions.preset, name)
    expression.morph_target_binds.clear()
    for shape, weight in shapes:
        bind = expression.morph_target_binds.add()
        bind.node.mesh_object_name = mesh.name
        bind.index = shape
        bind.weight = weight

# Gentle hair movement with enough stiffness to preserve the flame silhouette.
spring = ext.spring_bone1
spring.springs.clear()
for bone in arm.data.bones:
    if not bone.name.startswith('+Hair') or 'Fix' in bone.name: continue
    if bone.parent and bone.parent.name.startswith('+Hair'): continue
    chain = [bone]
    while True:
        children = [c for c in chain[-1].children if c.name.startswith('+Hair') and '錘' not in c.name]
        if not children: break
        chain.append(children[0])
    if len(chain) < 2: continue
    s = spring.springs.add()
    s.vrm_name = bone.name
    s.center.bone_name = '上半身2'
    for b in chain:
        j = s.joints.add()
        j.node.bone_name = b.name
        j.stiffness = 1.8
        j.gravity_power = .03
        j.drag_force = .65
        j.hit_radius = .012

# Keep the deliverable portable and select only the complete character.
bpy.ops.file.pack_all()
bpy.ops.object.select_all(action='DESELECT')
arm.hide_set(False); mesh.hide_set(False)
arm.select_set(True); mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'mavuika/mavuika-stella.blend'))
result = bpy.ops.export_scene.vrm(filepath=str(ROOT/'mavuika/mavuika-stella.vrm'), armature_object_name=arm.name, export_only_selections=True, export_all_influences=True, ignore_warning=True)
assert result == {'FINISHED'}, result
print('MAVUIKA_VRM_EXPORTED', json.dumps(mapping,ensure_ascii=False))
