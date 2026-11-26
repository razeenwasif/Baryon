"""Final collar and cuff adjustments after live crossed-arm inspection."""
from pathlib import Path
import ast, math
import bpy,bmesh
from mathutils import Vector
ROOT=Path('/Users/razeenwasif/Stella/avatar-work')
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
created=[]
tree=ast.parse((ROOT/'create_lab_outfit.py').read_text())
keep={'linear','interp','surface','body_weights','sleeve_weights','make_mesh','tube'}
parts=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in keep or isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='PROFILE' for t in n.targets)]
exec(compile(ast.Module(body=parts,type_ignores=[]),'<garment geometry utilities>','exec'),globals())
white=bpy.data.materials['Stella • tailored ivory-white cotton']
edge=bpy.data.materials['Stella • coat seams']
for obj in list(bpy.data.objects):
 if obj.name.startswith(('Upper collar •','Lower lapel •','Coat neckline facing')):bpy.data.objects.remove(obj,do_unlink=True)
for side in [-1,1]:
 for label,rows in [
  ('Upper collar',[(1.442,.044,.046),(1.455,.042,.112),(1.483,.035,.068),(1.508,.030,.034)]),
  ('Lower lapel',[(1.337,.120,.122),(1.378,.105,.131),(1.427,.062,.119),(1.440,.049,.064)])]:
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

# Extend the knitted sleeve under the bent wrist, retaining the existing skinning.
for obj in bpy.data.objects:
 if obj.name.startswith('Red knit wrist cuff') and not obj.get('wrist_extended'):
  for v in obj.data.vertices:
   x=abs(v.co.x);v.co.x=math.copysign(x+.011*max(0,min(1,(x-.575)/.019)),v.co.x)
   for vg in obj.vertex_groups:vg.remove([v.index])
   for bone,w in sleeve_weights(v.co).items():
    vg=obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
    if w>0:vg.add([v.index],w,'REPLACE')
  obj['wrist_extended']=True
# Keep the torso's existing painted fabric tension and under-bust shading.
mat=bpy.data.materials['Stella • flame-red fine knit']
for n in mat.node_tree.nodes:
 if n.type=='TEX_IMAGE':n.image=bpy.data.images['Stella sweater fabric shading']
print('DETAILS_FINISHED')

# Continuous fabric beneath the notched folds connects them to the coat body.
for side in [-1,1]:
 rows=[(1.375,.106,.134),(1.427,.060,.139),(1.455,.042,.130),(1.480,.035,.105),(1.499,.032,.070)]
 verts=[];faces=[];uv=[];N=16;R=60
 for j in range(R):
  z=rows[0][0]+(rows[-1][0]-rows[0][0])*j/(R-1)
  inner,outer=linear(z,rows)
  for i in range(N):
   u=i/(N-1);x=inner+(outer-inner)*u
   theta=math.asin(min(.995,x/(interp(z)[0]+.013)))
   _,y,_=surface(z,theta,.013)
   verts.append((side*x,y,z));uv.append((u,j/(R-1)))
 for j in range(R-1):
  for i in range(N-1):
   a=j*N+i;faces.append((a,a+1,a+N+1,a+N))
 make_mesh('Coat neckline facing '+str(side),verts,faces,white,uv=uv,solid=.001)
print('NECKLINE_FACING_FINISHED')
