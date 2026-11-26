import bpy,math
shirt=bpy.data.objects['Flame ribbed turtleneck']
if not shirt.get('visual_shape_polished'):
 for v in shirt.data.vertices:
  x,y,z=v.co
  if y<0 and 1.29<z<1.43:
   s=max(0,math.sqrt(max(0,1-(x/.145)**2)))
   old=.038*math.exp(-(x/.026)**2)*math.exp(-((z-1.36)/.047)**2)
   new=.022*math.exp(-(x/.029)**2)*math.exp(-((z-1.36)/.052)**2)
   lobes=math.exp(-((x-.071)/.043)**2)+math.exp(-((x+.071)/.043)**2)
   v.co.y+=(new-old)*s+.009*lobes*math.exp(-((z-1.358)/.044)**2)*s
 shirt['visual_shape_polished']=True
for m in bpy.data.materials:
 if not m.name.startswith('Stella •'):continue
 for node in m.node_tree.nodes if m.use_nodes else []:
  if node.type=='BSDF_PRINCIPLED':
   node.inputs['Roughness'].default_value=.94
   node.inputs['Specular IOR Level'].default_value=.10
   node.inputs['Sheen Weight'].default_value=.04
  if node.type=='MIX_RGB' and 'knit' in m.name:
   node.inputs[1].default_value=(.40,.065,.022,1)
# Keep the existing trousers' coherent toon finish, avoiding different light
# responses on the separately skinned upper panels.
for m in bpy.data.materials:
 if m.name=='Stella • black tailored trousers':
  g=m.vrm_addon_extension.mtoon1;g.enabled=True
  g.pbr_metallic_roughness.base_color_factor=(.025,.028,.038,1)
  g.extensions.vrmc_materials_mtoon.shade_color_factor=(.015,.016,.024)
  g.emissive_factor=(.0035,.0039,.0053)
print('MATTE_CLOTH_POLISHED')

# Remove unused source costume edges that obscure the Blender inspection view.
# Face geometry and facial shape layers are preserved.
import bmesh
original=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.shape_keys)
bm=bmesh.new();bm.from_mesh(original.data)
loose=[e for e in bm.edges if not e.link_faces]
bmesh.ops.delete(bm,geom=loose,context='EDGES_FACES')
bm.to_mesh(original.data);bm.free()
for m in bpy.data.materials:
 if m.name.startswith('Stella •'):
  for n in m.node_tree.nodes if m.use_nodes else []:
   if n.type=='BSDF_PRINCIPLED':n.inputs['Sheen Weight'].default_value=0
print('VIEWPORT_CLEANED')
