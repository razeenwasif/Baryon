"""Build Stella's approved fitted laboratory outfit, preserving her rig and face.
Personal local derivative: original character credits and licensing remain in VRM.
"""
from pathlib import Path
import sys, math, json
from collections import defaultdict
import bpy, bmesh
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from blender_bootstrap import enable_tools
enable_tools()
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'mavuika/mavuika-stella.blend'))
OUT=ROOT/'mavuika/outfits/lab-coat'; OUT.mkdir(parents=True,exist_ok=True)
arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
original=next(o for o in bpy.context.scene.objects if o.type=='MESH')
for key in original.data.shape_keys.key_blocks:key.value=0
created=[]

def material(name,color,shade=None,outline=.0003):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color[:3],color[3] if len(color)>3 else 1)
 rgba=(*color[:3],color[3] if len(color)>3 else 1)
 g=m.vrm_addon_extension.mtoon1;g.enabled=True;g.pbr_metallic_roughness.base_color_factor=rgba
 g.double_sided=True;g.alpha_mode='BLEND' if rgba[3]<1 else 'OPAQUE'
 g.emissive_factor=tuple(c*.14 for c in color[:3])
 t=g.extensions.vrmc_materials_mtoon;t.shade_color_factor=shade or tuple(c*.70 for c in color[:3]);t.shading_toony_factor=.65;t.shading_shift_factor=-.1;t.gi_equalization_factor=.8
 t.outline_width_mode='worldCoordinates' if outline else 'none';t.outline_width_factor=outline;t.outline_color_factor=tuple(c*.34 for c in color[:3])
 return m
red=material('Stella • flame-red fine knit',(.70,.135,.060),(.48,.076,.029))
white=material('Stella • tailored ivory-white cotton',(1.0,.99,.98),(.93,.92,.94))
white.vrm_addon_extension.mtoon1.emissive_factor=(.32,.31,.30)
edge=material('Stella • coat seams',(.72,.72,.75),(.60,.59,.63),0)
black=material('Stella • black tailored trousers',(.025,.028,.038),(.015,.016,.024))
frames=material('Stella • black acetate glasses',(.014,.012,.016),(.007,.007,.008),.00015)
skin=material('Stella • hands',(.94,.73,.64),(.73,.48,.40),.00025)
lens=material('Stella • clear lenses',(.80,.90,.97,.055),(.80,.90,.97),0)
button=material('Stella • warm neutral buttons',(.48,.38,.22),(.25,.20,.12),.0001)
# Portable baked procedural knit: subtle alternating vertical ribs, no external files.
W=512;H=256
img=bpy.data.images.new('Stella red knit ribs',width=W,height=H,alpha=False)
pixels=[]
for y in range(H):
 for x in range(W):
  phase=2*math.pi*x/W*80
  light=.93+.055*math.cos(phase)+.022*math.cos(phase*2)+.009*math.sin(y*.65+x*.8)
  pixels.extend((light,light,light,1))
img.pixels.foreach_set(pixels);img.pack()
g=red.vrm_addon_extension.mtoon1
g.pbr_metallic_roughness.base_color_texture.index.source=img
g.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source=img

# Preserve the simple rib texture for the collar and cuffs; add gentle garment
# shading to the torso's UVs, so it does not depend on runtime shadow support.
collar_red=red.copy();collar_red.name='Stella • softly rolled rib knit'
body_img=bpy.data.images.new('Stella sweater fabric shading',width=W,height=H,alpha=False)
body_pixels=[]
for y in range(H):
 z=1.105+(y/(H-1))*.433
 for x in range(W):
  theta=2*math.pi*x/W;front=max(0,math.cos(theta))**1.4
  seam_z=1.302+.020*math.exp(-(math.sin(theta)/.30)**2)
  shadow=.30*math.exp(-((z-seam_z)/.011)**2)*front
  highlight=.075*math.exp(-((z-1.365)/.038)**2)*front
  waist=.035*math.sin((z-1.11)*150+abs(math.sin(theta))*4)*math.exp(-((z-1.17)/.05)**2)*front
  # Soft fabric tension fans out from the fitted waist at either side.
  tension=.055*math.sin((z-1.125)*160+abs(math.sin(theta))*7)*math.exp(-((z-1.15)/.030)**2)*front
  v=max(.5,min(1,pixels[(y*W+x)*4]*(1-shadow+highlight+waist+tension)))
  body_pixels.extend((v,v,v,1))
body_img.pixels.foreach_set(body_pixels);body_img.pack()
red.vrm_addon_extension.mtoon1.pbr_metallic_roughness.base_color_texture.index.source=body_img
red.vrm_addon_extension.mtoon1.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source=body_img
sleeve_white=white.copy();sleeve_white.name='Stella • softly folded cotton sleeves'
cloth=bpy.data.images.new('Stella cotton sleeve folds',width=512,height=512,alpha=False)
cp=[]
for y in range(512):
 x=.082+(y/511)*.500
 for u in range(512):
  t=2*math.pi*u/512
  elbow=math.exp(-((x-.36)/.047)**2)
  shoulder=math.exp(-((x-.20)/.042)**2)
  fold=(.04+.15*math.sin(x*168+t*2.4))*elbow + (.02+.065*math.sin(x*155-t*3))*shoulder
  fold+=(.02+.065*math.sin(x*208-t*3.1))*math.exp(-((x-.315)/.027)**2)
  side=.028*(.5+.5*math.cos(t))
  v=max(.72,min(1,1-fold-side))
  cp.extend((v,v,v,1))
cloth.pixels.foreach_set(cp);cloth.pack()
sleeve_white.vrm_addon_extension.mtoon1.pbr_metallic_roughness.base_color_texture.index.source=cloth
sleeve_white.vrm_addon_extension.mtoon1.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source=cloth

# Remove the old outfit's surfaces, keeping original vertex indices and every
# facial shape key. The original .blend/.vrm are never overwritten.
parts={}
for mi in range(10,17):
 faces=[p for p in original.data.polygons if p.material_index==mi];parent={v:v for p in faces for v in p.vertices}
 def root(a):
  while parent[a]!=a:parent[a]=parent[parent[a]];a=parent[a]
  return a
 for p in faces:
  for v in p.vertices:parent[root(v)]=root(p.vertices[0])
 comps=defaultdict(list)
 for p in faces:comps[root(p.vertices[0])].append(p)
 ordered=sorted(comps.values(),key=lambda ps:-len(ps))
 for rank,ps in enumerate(ordered):
  vs=[original.data.vertices[v].co for p in ps for v in p.vertices]
  mn=Vector(tuple(min(v[i] for v in vs) for i in range(3)));mx=Vector(tuple(max(v[i] for v in vs) for i in range(3)))
  for p in ps:parts[p.index]=(rank,mn,mx)
# The source splits bare fingers and gloves into complementary UV islands.
# Recombine both hand surfaces into a separate watertight skinned mesh.
hand_polygons=[p for p in original.data.polygons if (p.material_index==12 and parts[p.index][0] in [0,1,2,3]) or (p.material_index==14 and parts[p.index][0] not in [0,1])]
hand_ids=sorted({v for p in hand_polygons for v in p.vertices});hand_map={v:i for i,v in enumerate(hand_ids)}
hand_vertices=[tuple(original.data.vertices[i].co) for i in hand_ids]
hand_faces=[tuple(hand_map[v] for v in p.vertices) for p in hand_polygons]
hand_binding={tuple(original.data.vertices[i].co):{original.vertex_groups[g.group].name:g.weight for g in original.data.vertices[i].groups if g.weight>0} for i in hand_ids}
for mat in [black,skin]:original.data.materials.append(mat)
black_i=len(original.data.materials)-2;skin_i=black_i+1
remove=[]
for p in original.data.polygons:
 mi=p.material_index
 if mi<10:continue
 rank,mn,mx=parts[p.index]
 keep=False
 if mi==10:
  keep=mx.z<.25 or mn.z>1.59
  if mx.z<.25:p.material_index=black_i
 elif mi==11:
  keep=mx.z<.25
  if keep:p.material_index=black_i
 elif mi==12:
  keep=mn.z>1.525 and max(abs(mn.x),abs(mx.x))<.105
  if rank in [2,3]:p.material_index=skin_i
 elif mi==13:
  keep=mn.z>1.50
  if mx.z<1.09:p.material_index=black_i
 elif mi==14:
  keep=False
 if not keep:remove.append(p.index)
bm=bmesh.new();bm.from_mesh(original.data);bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm,geom=[bm.faces[i] for i in remove],context='FACES_ONLY')
bm.to_mesh(original.data);bm.free()

# Body dimensions fitted in the original model's metric T-pose.
PROFILE=[
 (.72,.18,.108,.095),(.82,.178,.12,.104),(.95,.161,.128,.106),
 (1.06,.147,.127,.080),(1.10,.134,.111,.071),(1.16,.111,.094,.057),
 (1.22,.105,.098,.053),(1.27,.114,.118,.054),(1.31,.128,.149,.058),
 (1.35,.137,.177,.059),(1.39,.14,.166,.057),(1.425,.134,.12,.053),
 (1.455,.127,.075,.047),(1.478,.104,.064,.040),(1.50,.044,.052,.023),
 (1.515,.038,.057,.014),(1.55,.034,.057,.008)]
def linear(z,rows):
 for a,b in zip(rows,rows[1:]):
  if z<=b[0]:
   f=max(0,min(1,(z-a[0])/(b[0]-a[0])))
   return [a[i]*(1-f)+b[i]*f for i in range(1,len(a))]
 return list(rows[-1][1:])

def interp(z,rows=PROFILE):
 # Monotone cubic profiles avoid horizontal shelves at every measured ring.
 for k,(a,b) in enumerate(zip(rows,rows[1:])):
  if z<=b[0]:
   h=b[0]-a[0];f=max(0,min(1,(z-a[0])/h));out=[]
   for i in range(1,len(a)):
    d=(b[i]-a[i])/h
    prev=(a[i]-rows[k-1][i])/(a[0]-rows[k-1][0]) if k else d
    nex=(rows[k+2][i]-b[i])/(rows[k+2][0]-b[0]) if k+2<len(rows) else d
    m0=2*prev*d/(prev+d) if prev*d>0 else 0
    m1=2*nex*d/(nex+d) if nex*d>0 else 0
    out.append((2*f**3-3*f*f+1)*a[i]+(f**3-2*f*f+f)*h*m0+(-2*f**3+3*f*f)*b[i]+(f**3-f*f)*h*m1)
   return out
 return list(rows[-1][1:])
def surface(z,theta,pad=0):
 rx,front,back=interp(z)
 x=(rx+pad)*math.sin(theta);s=math.cos(theta)
 y=-(front+pad)*s if s>=0 else -(back+pad)*s
 # Soft central bridge rather than a rigid corset ridge.
 if s>0 and 1.29<z<1.43:
  # Separate rounded contours underneath continuous fabric; keep a soft
  # bridge at the sternum rather than treating the torso as one ellipse.
  y+=.038*math.exp(-(x/.026)**2)*math.exp(-((z-1.36)/.047)**2)*s
  lobes=math.exp(-((x-.071)/.043)**2)+math.exp(-((x+.071)/.043)**2)
  y-=.026*lobes*math.exp(-((z-1.358)/.044)**2)*s
  # A small inward return below the bust makes the knit look fitted.
  y+=.0065*lobes*math.exp(-((z-1.305)/.013)**2)*s
 # Gentle compression folds at the waist, strongest at the sides.
 if pad<.01 and 1.11<z<1.25:
  y-=.0014*math.sin((z-1.11)*155+abs(x)*32)*math.exp(-((z-1.17)/.057)**2)*max(0,s)
 if pad>=.010 and 1.10<z<1.27:
  side_fold=.0022*math.sin((z-1.13)*160+abs(x)*50)*math.exp(-((z-1.19)/.05)**2)*abs(math.sin(theta))**2
  x+=math.copysign(side_fold,x)
  y-=side_fold*max(0,s)
 return (x,y,z)

def body_weights(v):
 z=v[2]
 nodes=[(1.08,'腰'),(1.19,'上半身'),(1.28,'上半身1'),(1.43,'上半身2'),(1.56,'首')]
 if z<=nodes[0][0]:return {nodes[0][1]:1}
 for (za,a),(zb,b) in zip(nodes,nodes[1:]):
  if z<=zb:
   f=(z-za)/(zb-za)
   return {a:1-f,b:f}
 return {'首':1}

def make_mesh(name,verts,faces,mat,weights=body_weights,uv=None,solid=0):
 data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
 obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);data.materials.append(mat)
 for p in data.polygons:p.use_smooth=True
 if uv:
  layer=data.uv_layers.new(name='UVMap')
  for p in data.polygons:
   for li in p.loop_indices:layer.data[li].uv=uv[data.loops[li].vertex_index]
 for i,v in enumerate(verts):
  for bone,w in weights(v).items():
   if w>0:
    vg=obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone);vg.add([i],w,'REPLACE')
 # Correct orientation, retain two-sided rendering along garment openings.
 bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(data);bm.free()
 if solid:
  bpy.context.view_layer.objects.active=obj;obj.select_set(True)
  mod=obj.modifiers.new('Sewn fabric thickness','SOLIDIFY');mod.thickness=solid;mod.offset=0
  bpy.ops.object.modifier_apply(modifier=mod.name);obj.select_set(False)
 mod=obj.modifiers.new('Stella skeleton','ARMATURE');mod.object=arm
 obj.parent=arm;created.append(obj);return obj

hands=make_mesh('Stella • seamless bare hands',hand_vertices,hand_faces,skin,lambda v:hand_binding[tuple(v)])
hm=bmesh.new();hm.from_mesh(hands.data)
bmesh.ops.remove_doubles(hm,verts=list(hm.verts),dist=.00015)
bmesh.ops.holes_fill(hm,edges=[e for e in hm.edges if e.is_boundary],sides=0)
bmesh.ops.triangulate(hm,faces=list(hm.faces))
bmesh.ops.recalc_face_normals(hm,faces=hm.faces)
for f in hm.faces:f.smooth=True
hm.to_mesh(hands.data);hm.free()

def coat_gap(z):
 return interp(z,[(.72,.134),(.90,.114),(1.05,.098),(1.20,.083),(1.30,.104),(1.35,.127),(1.40,.123),(1.44,.096),(1.475,.060),(1.515,.042)])[0]

def loft(name,z0,z1,mat,pad=0,opening=False,N=96,R=76):
 verts=[];uv=[]
 for j in range(R):
  z=z0+(z1-z0)*j/(R-1)
  gap=coat_gap(z) if opening else 0
  angle=math.asin(min(.985,gap/(interp(z)[0]+pad))) if opening else 0
  for i in range(N+1):
   t=i/N;theta=angle+t*(2*math.pi-2*angle)
   extra=max(0,min(1,(1.22-z)/.14))*.025 if opening else 0
   verts.append(surface(z,theta,pad+extra));uv.append((t,(z-z0)/(z1-z0)))
 faces=[]
 for j in range(R-1):
  for i in range(N):
   a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
 return make_mesh(name,verts,faces,mat,uv=uv,solid=.0015 if opening else 0)
shirt=loft('Flame ribbed turtleneck',1.105,1.538,red,pad=.003)
# Folded high collar with softly rolled top and lower edge.
# Rounded roll: the top and bottom edges curl into the underlying neck.
verts=[];uv=[];faces=[];N=96;R=32
for j in range(R):
 t=j/(R-1);z=1.491+t*.059
 # Taper the folded knit around the actual neck, which sits behind the jaw.
 rx=.041*(1-t)+.0355*t+.0025*math.sin(math.pi*t)
 cy=-.024*(1-t)-.030*t
 ry=.035*(1-t)+.028*t+.002*math.sin(math.pi*t)
 for i in range(N+1):
  theta=2*math.pi*i/N
  v=(rx*math.sin(theta),cy-ry*math.cos(theta),z)
  verts.append(v);uv.append((i/N,t))
for j in range(R-1):
 for i in range(N):
  a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
collar=make_mesh('Soft rolled turtleneck collar',verts,faces,collar_red,uv=uv,solid=.001)

coat=loft('White laboratory coat • tailored body',.74,1.499,white,pad=.010,opening=True)

# Fitted sleeves follow the same upper/lower-arm weights as the original rig.
def sleeve_weights(v):
 x=abs(v[0]);jp='左' if v[0]>0 else '右'
 if x<.15:
  f=max(0,min(1,(x-.08)/.07));return {'上半身2':1-f,jp+'腕':f}
 if x<.30:return {jp+'腕':1}
 if x<.385:
  f=(x-.30)/.085;return {jp+'腕':1-f,jp+'ひじ':f}
 if x<.56:return {jp+'ひじ':1}
 f=min(1,(x-.56)/.045);return {jp+'ひじ':1-f,jp+'手首':f}

def sleeve(name,side,x0,x1,mat,pad=0):
 verts=[];uv=[];N=56;R=56
 for j in range(R):
  x=x0+(x1-x0)*j/(R-1)
  ry,rz=interp(x,[(.075,.046,.052),(.115,.051,.058),(.16,.050,.052),(.24,.039,.044),(.34,.034,.038),(.42,.032,.035),(.52,.028,.03),(.605,.025,.027)])
  for i in range(N+1):
   t=2*math.pi*i/N
   wrinkle=.0033*math.sin(x*168+t*2.4)*math.exp(-((x-.36)/.047)**2)
   wrinkle+=.0017*math.sin(x*208-t*3.1)*math.exp(-((x-.315)/.027)**2)
   wrinkle+=.0018*math.sin(x*155-t*3)*math.exp(-((x-.20)/.04)**2)
   verts.append((side*x,-.001+(ry+pad+wrinkle)*math.cos(t),1.453345+(rz+pad+wrinkle)*math.sin(t)));uv.append((i/N,(x-x0)/(x1-x0)))
 faces=[]
 for j in range(R-1):
  for i in range(N):
   a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
 return make_mesh(name,verts,faces,mat,sleeve_weights,uv,solid=.001)
for s in [-1,1]:
 sleeve('White coat fitted sleeve '+str(s),s,.082,.582,sleeve_white,.004)
 sleeve('Red knit wrist cuff '+str(s),s,.575,.594,collar_red,.001)

# Short folded lapels: sit at the shoulders instead of covering the sweater.
lapel_outlines=[]
for side in [-1,1]:
 verts=[];faces=[];uv=[];N=12;R=64
 for j in range(R):
  z=1.357+j/(R-1)*.142
  inner,outer=linear(z,[(1.357,.123,.125),(1.382,.114,.136),(1.414,.086,.143),
    (1.432,.074,.144),(1.443,.066,.116),(1.451,.061,.132),
    (1.472,.048,.112),(1.487,.041,.083),(1.499,.040,.050)])
  for i in range(N):
   u=i/(N-1);x=inner+(outer-inner)*u
   theta=math.asin(min(.99,x/(interp(z)[0]+.013)))
   _,y,_=surface(z,theta,.013)
   # Roll line lifts the inner edge and gives a real folded cross-section.
   y-=.007+.006*math.sin(math.pi*u)
   verts.append((side*x,y,z));uv.append((u,j/(R-1)))
 for j in range(R-1):
  for i in range(N-1):
   a=j*N+i;faces.append((a,a+1,a+N+1,a+N))
 make_mesh('Notched folded coat lapel '+str(side),verts,faces,white,uv=uv,solid=.002)
 lapel_outlines.append([verts[j*N+N-1] for j in range(R)])

# Curved piping and seams use the same skinning as their garment.
def tube(name,points,radius,mat,weights=body_weights,closed=False):
 verts=[];faces=[];S=8
 for i,p in enumerate(points):
  p=Vector(p)
  tangent=(Vector(points[(i+1)%len(points)])-Vector(points[i-1 if i else (-1 if closed else 0)])) if (closed or 0<i<len(points)-1) else (Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)]))
  tangent.normalize();u=tangent.cross(Vector((0,1,0)))
  if u.length<.01:u=tangent.cross(Vector((1,0,0)))
  u.normalize();v=tangent.cross(u).normalized()
  for k in range(S):verts.append(tuple(p+radius*(u*math.cos(2*math.pi*k/S)+v*math.sin(2*math.pi*k/S))))
 for i in range(len(points) if closed else len(points)-1):
  for k in range(S):faces.append((i*S+k,i*S+(k+1)%S,((i+1)%len(points))*S+(k+1)%S,((i+1)%len(points))*S+k))
 return make_mesh(name,verts,faces,mat,weights)

# Two coat pockets follow the front panel curvature, with folded top lips.
for s in [-1,1]:
 verts=[];N=10;R=12
 for j in range(R):
  z=.927+j/(R-1)*.107
  for i in range(N):
   x=.126+i/(N-1)*.042;rx=interp(z)[0]+.014;t=math.asin(min(.97,x/rx))
   _,y,_=surface(z,t,.016);verts.append((s*x,y-.0015,z))
 faces=[]
 for j in range(R-1):
  for i in range(N-1):a=j*N+i;faces.append((a,a+1,a+N+1,a+N))
 make_mesh('Lab coat patch pocket '+str(s),verts,faces,white,solid=.0015)
 tube('Pocket top stitch '+str(s),[(x,y-.001,z+.001) for x,y,z in verts[-N:]],.00065,edge)
 for angle in [.92,2.18]:
  pts=[surface(.82+j/35*.56,s*angle,.0152) for j in range(36)]
  tube('Coat shaping seam '+str(s)+' '+str(angle),pts,.00045,edge)

# Clean stitched edges and cuff bands make the tailoring legible in floating mode.
for idx,points in enumerate(lapel_outlines):
 tube('Lapel edge stitching '+str(idx),[(x,y-.001,z) for x,y,z in points],.00038,edge)
for side in [-1,1]:
 pts=[]
 for j in range(100):
  z=.75+j/99*.61
  x=coat_gap(z)+.003
  extra=max(0,min(1,(1.22-z)/.14))*.025
  theta=math.asin(min(.98,x/(interp(z)[0]+.010)))
  sx,y,_=surface(z,theta,.010+extra)
  pts.append((side*sx,y-.0006,z))
 tube('Coat front sewn edge '+str(side),pts,.00028,edge)
 for x in [.555,.578]:
  ry,rz=interp(x,[(.52,.028,.030),(.605,.025,.027)])
  pts=[(side*x,-.001+(ry+.0046)*math.cos(t*2*math.pi/64),1.453345+(rz+.0046)*math.sin(t*2*math.pi/64)) for t in range(64)]
  tube('Coat cuff seam '+str(side)+' '+str(x),pts,.0004,edge,sleeve_weights,True)

# Folded pocket flaps and small fastenings follow the coat surface.
coat_button=material('Stella • ivory coat buttons',(.89,.89,.87),(.70,.70,.72),.0001)
for side in [-1,1]:
 verts=[];faces=[];N=14;R=8
 for j in range(R):
  z=1.016+j/(R-1)*.026
  for i in range(N):
   x=.126+i/(N-1)*.042
   theta=math.asin(min(.98,x/(interp(z)[0]+.014)))
   _,y,_=surface(z,theta,.019)
   verts.append((side*x,y-.003,z))
 for j in range(R-1):
  for i in range(N-1):
   a=j*N+i;faces.append((a,a+1,a+N+1,a+N))
 make_mesh('Folded pocket flap '+str(side),verts,faces,white,solid=.0014)
 tube('Pocket flap lower stitch '+str(side),[(x,y-.001,z+.001) for x,y,z in verts[:N]],.00035,edge)
 for z in [1.19,1.105,1.02]:
  extra=max(0,min(1,(1.22-z)/.14))*.025
  angle=math.asin(min(.98,(coat_gap(z)+.009)/(interp(z)[0]+.010)))
  x,y,_=surface(z,angle,.010+extra)
  x*=side;y-=.0015
  if side<0:
   vs=[(x,y-.0007,z)]+[(x+.0025*math.cos(i*2*math.pi/24),y,z+.0025*math.sin(i*2*math.pi/24)) for i in range(24)]
   make_mesh('Coat button '+str(z),vs,[(0,i+1,(i+1)%24+1) for i in range(24)],coat_button)
  else:
   tube('Coat buttonhole '+str(z),[(x,y,z-.003),(x,y,z+.003)],.00028,edge)

# Black rectangular glasses, curved around the face, kept clear of blinking.
head=lambda v:{'頭':1}
def glass_y(x):return -.153+.035*(abs(x)/.076)**2
for s in [-1,1]:
 cx=s*.038;cz=1.630;hw=.032;hh=.0108;cr=.0055
 points=[]
 for ox,oz,start in [(hw-cr,hh-cr,0),(-hw+cr,hh-cr,90),(-hw+cr,-hh+cr,180),(hw-cr,-hh+cr,270)]:
  for k in range(9):
   a=math.radians(start+k/8*90);x=cx+ox+cr*math.cos(a);z=cz+oz+cr*math.sin(a);points.append((x,glass_y(x),z))
 tube('Black rounded rectangular frame '+str(s),points,.00072,frames,head,True)
 center=(cx,glass_y(cx)+.001,cz)
 make_mesh('Clear optical lens '+str(s),[center]+[(x,y+.0008,z) for x,y,z in points],[(0,i+1,(i+1)%len(points)+1) for i in range(len(points))],lens,head)
 tube('Black temple arm '+str(s),[(s*.069,glass_y(.069),1.637),(s*.078,-.101,1.637),(s*.085,-.060,1.644),(s*.086,-.021,1.647),(s*.081,-.004,1.639)],.00085,frames,head)
tube('Black glasses nose bridge',[(-.008,-.152,1.633),(-.005,-.155,1.636),(0,-.157,1.637),(.005,-.155,1.636),(.008,-.152,1.633)],.00075,frames,head)

# Complete black trousers replace the old suit panels and ornamental gaps.
def trouser_weights(v):
 z=v[2];side='左' if v[0]>=0 else '右'
 if z>1.025:
  f=min(1,(z-1.025)/.075);return {side+'足D':1-f,'腰':f}
 if z>.66:return {side+'足D':1}
 if z>.56:
  f=(z-.56)/.10;return {side+'足D':f,side+'ひざD':1-f}
 return {side+'ひざD':1}
for side in [-1,1]:
 verts=[];faces=[];N=64;R=94
 for j in range(R):
  z=.174+j/(R-1)*.912
  cx,cy,rx,ry=interp(z,[(.174,.068,.006,.032,.036),(.26,.073,.010,.033,.041),(.38,.079,.012,.044,.052),(.47,.079,.010,.041,.048),(.60,.078,-.018,.041,.045),(.72,.082,-.023,.053,.060),(.88,.088,-.021,.068,.083),(.99,.088,-.020,.075,.095),(1.086,.083,-.020,.077,.096)])
  for i in range(N+1):
   t=2*math.pi*i/N;verts.append((side*cx+rx*math.sin(t),cy-ry*math.cos(t),z))
 for j in range(R-1):
  for i in range(N):a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
 make_mesh('Fitted black trouser leg '+str(side),verts,faces,black,trouser_weights)
loft('Black trouser hips',1.023,1.124,black,pad=-.011,N=80,R=20)
loft('Black trouser waistband',1.102,1.124,black,pad=.004,N=80,R=6)

# Waist button, fly and belt loops, as in the approved concept.
verts=[(0,-.116,1.110)];faces=[]
for i in range(32):
 t=2*math.pi*i/32;verts.append((.005*math.cos(t),-.115,1.110+.005*math.sin(t)))
for i in range(32):faces.append((0,i+1,(i+1)%32+1))
make_mesh('Warm brass trouser button',verts,faces,button)
trouser_edge=material('Stella • charcoal trouser topstitch',(.07,.07,.08),(.035,.035,.04),0)
fly=[]
for x,z in [(.012,1.100),(.014,1.075),(.016,1.050),(.008,1.030)]:
 theta=math.asin(x/(interp(z)[0]-.011))
 _,y,_=surface(z,theta,-.010)
 fly.append((x,y-.001,z))
tube('Trouser fly seam',fly,.00035,trouser_edge)
for side in [-1,1]:
 x=side*.057
 theta=math.asin(abs(x)/(.134+.004))
 pts=[]
 for j in range(12):
  z=1.098+j/11*.029
  _,y,_=surface(z,theta,.008)
  pts.append((x,y-.002,z))
 tube('Black trouser belt loop '+str(side),pts,.0023,black)

meta=arm.data.vrm_addon_extension.vrm1.meta
meta.vrm_name='Stella • flame turtleneck and white laboratory coat';meta.version='1.2-lab-coat-refined'
meta.copyright_information+=' Outfit and glasses: custom personal design for Stella.'
bpy.ops.file.pack_all()
bpy.ops.object.select_all(action='DESELECT')
for obj in [arm,original]+created:obj.hide_set(False);obj.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.context.view_layer.update()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'stella-lab-coat.blend'))
result=bpy.ops.export_scene.vrm(filepath=str(OUT/'stella-lab-coat.vrm'),armature_object_name=arm.name,export_only_selections=False,export_invisibles=True,export_all_influences=True,ignore_warning=True)
assert result=={'FINISHED'}
import struct
data=(OUT/'stella-lab-coat.vrm').read_bytes(); gltf=json.loads(data[20:20+struct.unpack_from('<I',data,12)[0]])
assert len(gltf.get('meshes',[]))>=20, 'Missing outfit geometry in exported VRM'
print('OUTFIT_EXPORTED',json.dumps({'objects':len(created),'faces':sum(len(o.data.polygons) for o in created),'path':str(OUT/'stella-lab-coat.vrm')}))
