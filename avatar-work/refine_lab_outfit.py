"""Visual tailoring pass, run inside Blender's live Python console.
Keeps a checkpoint of the open scene; exports an unposed VRM and editable blend.
"""
from pathlib import Path
import sys, ast, math, json
import bpy,bmesh
from mathutils import Vector,Quaternion
ROOT=Path('/Users/razeenwasif/Stella/avatar-work')
OUT=ROOT/'mavuika/outfits/lab-coat'
sys.path.insert(0,str(ROOT))
from blender_bootstrap import enable_tools
enable_tools()
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
checkpoint=OUT/'v2-backup/live-before-refine.blend'
if not checkpoint.exists():
 bpy.ops.wm.save_as_mainfile(filepath=str(checkpoint),copy=True)
# For another pass, reopen the checkpoint before running this script.
created=[]
# Reuse only the mesh construction utilities, without running the original builder.
tree=ast.parse((ROOT/'create_lab_outfit.py').read_text())
keep={'linear','interp','surface','body_weights','sleeve_weights','make_mesh','tube'}
parts=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in keep or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PROFILE' for t in n.targets)]
exec(compile(ast.Module(body=parts,type_ignores=[]),'<garment geometry utilities>','exec'),globals())
white=bpy.data.materials['Stella • tailored ivory-white cotton']
edge=bpy.data.materials['Stella • coat seams']
# Crisp collar and lapel pieces have an actual gap at the notch and a roll line.
for o in list(bpy.data.objects):
 if o.name.startswith(('Notched folded coat lapel','Lapel edge stitching')):
  bpy.data.objects.remove(o,do_unlink=True)
for side in [-1,1]:
 for label,rows in [
  ('Upper collar',[(1.447,.051,.099),(1.464,.045,.132),(1.480,.039,.104),(1.504,.034,.052)]),
  ('Lower lapel',[(1.337,.120,.122),(1.378,.105,.136),(1.430,.062,.147),(1.449,.054,.108)])]:
  N=16;R=60;verts=[];uv=[];faces=[]
  for j in range(R):
   z=rows[0][0]+(rows[-1][0]-rows[0][0])*j/(R-1)
   inner,outer=linear(z,rows)
   for i in range(N):
    u=i/(N-1);x=inner+(outer-inner)*u
    theta=math.asin(min(.995,x/(interp(z)[0]+.012)))
    _,y,_=surface(z,theta,.012)
    # Fold away from the torso at the inner roll, with a thinner outer edge.
    y-=.009+.007*math.sin(math.pi*u)
    if label=='Upper collar':y-=.003
    verts.append((side*x,y,z));uv.append((u,j/(R-1)))
  for j in range(R-1):
   for i in range(N-1):
    a=j*N+i;faces.append((a,a+1,a+N+1,a+N))
  make_mesh(label+' • tailored '+str(side),verts,faces,white,uv=uv,solid=.0017)
  # Stitched outline remains inset from the thickness rim.
  border=[verts[j*N+N-2] for j in range(R)]+[verts[(R-1)*N+i] for i in range(N-3,0,-1)]
  tube(label+' • inset stitching '+str(side),[(x,y-.001,z) for x,y,z in border],.0003,edge)
# Make the collar read as a folded knit roll instead of a straight tube.
collar=bpy.data.objects.get('Soft rolled turtleneck collar')
for v in collar.data.vertices:
 z=v.co.z;t=max(0,min(1,(z-1.491)/.059))
 bulge=.0025*math.sin(math.pi*t)**2
 v.co.x*=1+bulge/.04
 v.co.y=-.029+(v.co.y+.029)*(1+bulge/.03)
 # Slight dip at the front edge reveals the neck entering the opening.
 front=max(0,min(1,(-v.co.y-.025)/.032))
 v.co.z-=.0025*front*t**5
# Snug knit cuffs fill the gap between coat and wrists in the crossed pose.
for o in bpy.data.objects:
 if o.name.startswith('Red knit wrist cuff'):
  for v in o.data.vertices:
   v.co.y=-.001+(v.co.y+.001)*.80
   v.co.z=1.453345+(v.co.z-1.453345)*.80
# Garment PBR materials: diffuse fabric, without the broad toon shadow bands.
# The face and hair retain their original MToon materials.
for m in list(bpy.data.materials):
 if not m.name.startswith('Stella •'):continue
 if not any(w in m.name for w in ['knit','cotton','trousers','coat seams','coat buttons','trouser topstitch']):continue
 color=tuple(m.diffuse_color)
 tex=None
 if 'knit' in m.name:tex=bpy.data.images.get('Stella red knit ribs')
 if 'cotton sleeves' in m.name:tex=bpy.data.images.get('Stella cotton sleeve folds')
 if m.vrm_addon_extension.mtoon1.enabled:m.vrm_addon_extension.mtoon1.enabled=False
 m.use_nodes=True;nodes=m.node_tree.nodes;nodes.clear();links=m.node_tree.links
 output=nodes.new('ShaderNodeOutputMaterial');bsdf=nodes.new('ShaderNodeBsdfPrincipled')
 bsdf.inputs['Base Color'].default_value=color
 bsdf.inputs['Roughness'].default_value=.84
 bsdf.inputs['Specular IOR Level'].default_value=.20
 bsdf.inputs['Sheen Weight'].default_value=.13
 links.new(bsdf.outputs['BSDF'],output.inputs['Surface'])
 if tex:
  image=nodes.new('ShaderNodeTexImage');image.image=tex
  mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[1].default_value=color
  links.new(image.outputs['Color'],mix.inputs[2]);links.new(mix.outputs[0],bsdf.inputs['Base Color'])
# Subtle smoothing removes hard rings while retaining the fitted silhouette.
shirt=bpy.data.objects.get('Flame ribbed turtleneck')
# Weld coincident seam vertices before smoothing so the front cannot split.
bm=bmesh.new();bm.from_mesh(shirt.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00002)
bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
bm.to_mesh(shirt.data);bm.free()
hands=bpy.data.objects.get('Stella • seamless bare hands')
if hands:hands.data.validate(clean_customdata=False)
bpy.ops.object.select_all(action='DESELECT');shirt.select_set(True);bpy.context.view_layer.objects.active=shirt
mod=shirt.modifiers.new('Soft knit contours','SMOOTH');mod.factor=.45;mod.iterations=3
bpy.ops.object.modifier_move_up(modifier=mod.name)
bpy.ops.object.modifier_apply(modifier=mod.name)
arm.data.vrm_addon_extension.vrm1.meta.version='1.3-visual-tailoring'
# Set a useful live inspection viewport. Save/export are called separately after review.
for screen in bpy.data.screens:
 for area in screen.areas:
  if area.type=='VIEW_3D':
   space=area.spaces.active;space.overlay.show_overlays=False;space.shading.type='MATERIAL'
   space.region_3d.view_rotation=Quaternion((1,0,0),math.pi/2)
   space.region_3d.view_perspective='ORTHO';space.region_3d.view_location=(0,0,1.35);space.region_3d.view_distance=1.65
print('LIVE_TAILORING_READY')
