"""Create a separate red halter-knit dress, preserving Stella's face and rig.

Run with Blender's Python. All generated assets remain local to avatar-work.
The source character's embedded credits and usage restrictions are preserved.
"""
from pathlib import Path
import ast, sys, math, json, struct
import bpy, bmesh
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'mavuika/outfits/red-keyhole'
OUT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT))
from blender_bootstrap import enable_tools
enable_tools()
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'mavuika/outfits/lab-coat/stella-visual-tailoring.blend'))
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
original = next(o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.shape_keys)
for b in arm.pose.bones:
    b.matrix_basis.identity()
for k in original.data.shape_keys.key_blocks:
    k.value = 0
created = []
tree = ast.parse((ROOT / 'create_lab_outfit.py').read_text())
keep = {'linear', 'interp', 'surface', 'body_weights', 'sleeve_weights', 'trouser_weights', 'make_mesh', 'tube', 'material'}
parts = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in keep
         or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'PROFILE' for t in n.targets)]
exec(compile(ast.Module(body=parts, type_ignores=[]), '<existing rig geometry utilities>', 'exec'), globals())

# Keep the original character, hands and glasses; the old outfit stays in its
# own .blend and .vrm. The collar is rebuilt with the same neck alignment.
for obj in list(bpy.context.scene.objects):
    if obj.type == 'MESH' and obj != original and not obj.name.startswith(
        ('Stella • seamless bare hands', 'Black rounded rectangular frame', 'Clear optical lens', 'Black temple arm', 'Black glasses nose bridge')):
        bpy.data.objects.remove(obj, do_unlink=True)
    elif obj.type in {'CAMERA', 'LIGHT', 'EMPTY'} and obj.parent != arm:
        if obj.name.startswith('Reference'):
            bpy.data.objects.remove(obj, do_unlink=True)

def fabric(name, ribs, rows):
    """Embedded knit albedo and tangent normal map; no external textures."""
    import numpy as np
    W, H = 1024, 1024
    yy, xx = np.mgrid[0:H, 0:W]
    u, v = xx / W, yy / H
    angle=u*2*math.pi
    z=.775+v*.725
    front=np.maximum(0,np.cos(angle))**2
    warp=np.zeros_like(u)
    if 'keyhole' in name:
        warp=.005*np.sin((z-1.26)*35)*np.exp(-((z-1.285)/.055)**2)*front*np.sin(angle)
    phase = (u+warp) * ribs * 2 * math.pi
    stitch = np.sin(v * rows * 2 * math.pi + .7 * np.cos(phase))
    h = .68 * np.cos(phase) + .16 * np.cos(phase * 2) + .14 * stitch * np.maximum(0, np.cos(phase))
    shade = np.clip(.945 + .034*h + .008*stitch, .8, 1)
    if 'keyhole' in name:
        side=np.abs(np.sin(angle))
        for height,strength in [(1.258,.15),(1.282,.11),(1.175,.08)]:
            fold_z=height+.034*side
            fold=np.exp(-((z-fold_z)/.0032)**2)*front*side
            shine=np.exp(-((z-fold_z-.004)/.004)**2)*front*side
            shade*=1-strength*fold+.025*shine
    albedo = np.ones((H, W, 4), dtype=np.float32)
    albedo[:, :, :3] = shade[:, :, None]
    image = bpy.data.images.new(name + ' stitch color', width=W, height=H, alpha=False)
    image.pixels.foreach_set(albedo.ravel()); image.pack()
    normal = np.ones((H, W, 4), dtype=np.float32)
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * .5
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * .5
    vec = np.stack((-dx * 2.5, -dy * 1.0, np.ones_like(h)), axis=-1)
    vec /= np.linalg.norm(vec, axis=-1, keepdims=True)
    normal[:, :, :3] = vec * .5 + .5
    nm = bpy.data.images.new(name + ' stitch normals', width=W, height=H, alpha=False)
    nm.colorspace_settings.name = 'Non-Color'; nm.pixels.foreach_set(normal.ravel()); nm.pack()
    mat=material(name,(.61,.085,.035),(.39,.035,.012),0)
    g=mat.vrm_addon_extension.mtoon1
    g.pbr_metallic_roughness.base_color_texture.index.source=image
    g.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source=image
    g.normal_texture.index.source=nm;g.normal_texture.scale=.13
    g.emissive_factor=(.035,.004,.0005)
    g.extensions.khr_materials_emissive_strength.emissive_strength=1
    toon=g.extensions.vrmc_materials_mtoon
    toon.shading_toony_factor=.82;toon.shading_shift_factor=-.13
    toon.gi_equalization_factor=.8;toon.outline_color_factor=(.19,.040,.018)
    return mat

red = fabric('Stella • red keyhole knit', 92, 180)
rib = fabric('Stella • red folded ribbing', 68, 38)
trim = material('Stella • red knit binding', (.65, .15, .080), (.40, .062, .030), .00022)
skin = material('Stella • uncovered skin', (1.0, .91, .78), (.96, .79, .66), 0)
sg=skin.vrm_addon_extension.mtoon1
sg.emissive_factor=(.10,.05,.015)
sg.extensions.khr_materials_emissive_strength.emissive_strength=1
st=sg.extensions.vrmc_materials_mtoon
st.shading_toony_factor=.86;st.shading_shift_factor=-.13;st.gi_equalization_factor=.8
st.outline_color_factor=(.30,.17,.16);st.outline_lighting_mix_factor=1
hands = bpy.data.objects['Stella • seamless bare hands']
hands.data.materials.clear(); hands.data.materials.append(skin)
# Retain the original finger topology and weights while softening glove seams.
for v in hands.data.vertices:
    if abs(v.co.x)<.621:
        r=math.hypot(v.co.y+.001,v.co.z-1.453345)
        limit=.019+.16*max(0,abs(v.co.x)-.602)
        if r>limit:
            f=limit/r;v.co.y=-.001+(v.co.y+.001)*f;v.co.z=1.453345+(v.co.z-1.453345)*f
for m in list(hands.modifiers):
    if m.type=='NODES':hands.modifiers.remove(m)
bpy.ops.object.select_all(action='DESELECT');hands.hide_set(False);hands.select_set(True);bpy.context.view_layer.objects.active=hands
hm=hands.modifiers.new('Soft hand surface','SMOOTH');hm.factor=.55;hm.iterations=3
bpy.ops.object.modifier_move_up(modifier=hm.name);bpy.ops.object.modifier_apply(modifier=hm.name)
for p in hands.data.polygons:p.use_smooth=True

def smooth_surface(z, theta, pad=0):
    x, y, _ = surface(z, theta, pad)
    front=max(0,math.cos(theta))
    if front and 1.245<z<1.480:
        # Two separately rounded volumes join a narrower underlying ribcage.
        # This replaces the old single elliptical chest with a carved groove.
        base=interp(z,[(1.245,.103),(1.28,.103),(1.31,.098),(1.35,.090),
                       (1.39,.085),(1.425,.080),(1.455,.073),(1.480,.064)])[0]
        caps=[]
        for side in (-1,1):
            q=((x-side*.067)/.078)**2+((z-1.357)/.079)**2
            v=max(0,1-q)
            # Smooth the join into the upper chest and under-chest surface.
            edge=min(1,v/.26);edge=edge*edge*(3-2*edge)
            caps.append(.104*v**.65*edge)
        left,right=caps
        if max(caps)>0:
            h=max(0,min(1,.5+.5*(left-right)/.005))
            volume=right+(left-right)*h+.005*h*(1-h)
        else:volume=0
        # Side-facing surfaces stay continuous with the torso shell.
        y_new=-(base+pad)*front-volume
        weight=min(1,(z-1.245)/.025,(1.480-z)/.025)
        weight=max(0,weight);weight=weight*weight*(3-2*weight)
        y=y*(1-weight)+y_new*weight
        # Small clavicle relief helps the transition below the halter collar.
        clavicle=1.449+.09*abs(x)
        y-=.0022*math.exp(-((z-clavicle)/.0055)**2-(x/.085)**4)*front
    return (x,y,z)

def upper_weights(v):
    x, y, z = v
    # Blend the shoulder into the chest continuously, then use the same elbow
    # and wrist transitions as Stella's existing gestures.
    height=max(0,min(1,(z-1.378)/.024));height=height*height*(3-2*height)
    amount=max(0,min(1,(abs(x)-.083)/.087))*height
    bw = body_weights(v); sw = sleeve_weights(v); result = {}
    if abs(x)>.56:
        side='左' if x>0 else '右'; f=min(1,(abs(x)-.56)/.03)
        sw={side+'ひじ':1-f,side+'手首':f}
    for bone, w in bw.items(): result[bone] = result.get(bone, 0) + w * (1 - amount)
    for bone, w in sw.items(): result[bone] = result.get(bone, 0) + w * amount
    return result

# Build a seamless shoulder/arm surface. The source outfit did not contain skin
# underneath its sleeves, so recoloring or hiding sleeves would leave holes.
verts, faces = [], []
N, R = 128, 132
for j in range(R):
    z = 1.10 + .432 * j / (R - 1)
    for i in range(N):
        t=i/N*2*math.pi;x,y,_=smooth_surface(z,t,-.002)
        c=max(0,math.cos(t))
        lobes=math.exp(-((x-.071)/.043)**2)+math.exp(-((x+.071)/.043)**2)
        if 1.11<z<1.25:y+=.0014*math.sin((z-1.11)*155+abs(x)*32)*math.exp(-((z-1.17)/.057)**2)*c
        verts.append((x,y,z))
for j in range(R - 1):
    for i in range(N):
        a = j * N + i; b = j * N + (i + 1) % N
        faces.append((a, b, b + N, a + N))
faces += [tuple(reversed(range(N))), tuple((R - 1) * N + i for i in range(N))]
body = make_mesh('Stella • seamless shoulders and arms', verts, faces, skin, upper_weights)
pieces = [body]
for side in (-1, 1):
    verts, faces = [], []; N, R = 64, 110
    for j in range(R):
        x = .086 + (.610 - .086) * j / (R - 1)
        ry, rz = interp(x, [(.086,.044,.046),(.14,.048,.048),(.19,.044,.043),(.25,.034,.035),(.342,.026,.028),(.40,.030,.029),(.48,.024,.024),(.56,.019,.020),(.602,.018,.0185)])
        for i in range(N):
            t = i / N * 2 * math.pi
            verts.append((side * x, -.001 + ry * math.cos(t), 1.453345 + rz * math.sin(t)))
    for j in range(R - 1):
        for i in range(N):
            a=j*N+i; b=j*N+(i+1)%N; faces.append((a,b,b+N,a+N))
    faces += [tuple(reversed(range(N))), tuple((R-1)*N+i for i in range(N))]
    pieces.append(make_mesh('Arm surface '+str(side),verts,faces,skin,upper_weights))
bpy.ops.object.select_all(action='DESELECT')
for o in pieces:
    o.select_set(True)
    for m in list(o.modifiers): o.modifiers.remove(m)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.data.remesh_voxel_size = .0015
bpy.ops.object.voxel_remesh()
mod=body.modifiers.new('Smooth shoulder transitions','SMOOTH'); mod.factor=.6; mod.iterations=4
bpy.ops.object.modifier_apply(modifier=mod.name)
# Restore the authored chest surface after the shoulder union, and use its
# analytical normals so cell shading does not reveal the voxel grid.
def chest_y(x,z):
    radius=interp(z)[0]-.002
    t=math.asin(max(-.999,min(.999,x/radius)))
    return smooth_surface(z,t,-.002)[1]
for v in body.data.vertices:
    x,y,z=v.co
    if abs(x)<.126 and 1.27<z<1.445 and y<-.06:
        expected=chest_y(x,z)
        if abs(y-expected)<.006:v.co.y=expected
body.data.update()
custom=[]
for v in body.data.vertices:
    x,y,z=v.co;n=v.normal.copy()
    if abs(x)<.120 and 1.28<z<1.435 and y<-.06 and abs(y-chest_y(x,z))<.003:
        e=.0002;dx=(chest_y(x+e,z)-chest_y(x-e,z))/(2*e)
        dz=(chest_y(x,z+e)-chest_y(x,z-e))/(2*e)
        analytic=Vector((dx,-1,dz)).normalized()
        weight=min(1,(.120-abs(x))/.015,(z-1.28)/.012,(1.435-z)/.012)
        n=n.lerp(analytic,max(0,weight)).normalized()
    custom.append(tuple(n))
body.data.normals_split_custom_set_from_vertices(custom)
body.vertex_groups.clear()
for v in body.data.vertices:
    for bone,w in upper_weights(v.co).items():
        if w>0:
            vg=body.vertex_groups.get(bone) or body.vertex_groups.new(name=bone); vg.add([v.index],w,'REPLACE')
for p in body.data.polygons:p.use_smooth=True
body.modifiers.new('Stella skeleton','ARMATURE').object=arm

# Authored cell-style skin accents follow the mesh contours. Narrow tapered
# lines and restrained shadow regions retain definition without glossy shading.
import numpy as np
W,H=2048,2048
yy,xx=np.mgrid[0:H,0:W];px=xx/(W-1)*.44-.22;pz=1.10+yy/(H-1)*.45
ssmooth=lambda a,b,x:np.clip((x-a)/(b-a),0,1)**2*(3-2*np.clip((x-a)/(b-a),0,1))
span=ssmooth(1.348,1.366,pz)*(1-ssmooth(1.394,1.411,pz))
center=.001+.004*np.sin((pz-1.35)*45)
width=.019+.011*np.exp(-((pz-1.328)/.032)**2)
core=1-ssmooth(.0004,.0012,np.abs(px-center))
inner=(1-ssmooth(width*.30,width*.70,np.abs(px-center-.004)))*ssmooth(1.316,1.345,pz)*(1-ssmooth(1.393,1.418,pz))
line=core*span*.30
under_z=1.298+.020*np.exp(-(px/.033)**2)
under=(1-ssmooth(.001,.004,np.abs(pz-under_z)))*ssmooth(.012,.025,np.abs(px))*(1-ssmooth(.067,.080,np.abs(px)))
clavicle_z=1.449+.09*np.abs(px)
clavicle=(1-ssmooth(.0005,.0025,np.abs(pz-clavicle_z)))*ssmooth(.009,.021,np.abs(px))*(1-ssmooth(.065,.082,np.abs(px)))
shadow=np.maximum(inner*.38,clavicle*.10)
pixels=np.ones((H,W,4),dtype=np.float32)
for c,target in enumerate([.73,.57,.53]):pixels[:,:,c]=1-shadow*(1-target)-line*(1-target)*.85
chest_image=bpy.data.images.new('Stella drawn skin contour accents',width=W,height=H,alpha=False)
chest_image.pixels.foreach_set(pixels.ravel());chest_image.pack()
chest_mat=skin.copy();chest_mat.name='Stella • shaped chest skin'
cg=chest_mat.vrm_addon_extension.mtoon1
cg.pbr_metallic_roughness.base_color_texture.index.source=chest_image
cg.extensions.vrmc_materials_mtoon.shade_multiply_texture.index.source=chest_image
body.data.materials.clear();body.data.materials.append(chest_mat)
uv=body.data.uv_layers.new(name='Chest shading UV')
for p in body.data.polygons:
    for li in p.loop_indices:
        v=body.data.vertices[body.data.loops[li].vertex_index].co
        uv.data[li].uv=(max(.001,min(.999,(v.x+.22)/.44)),max(.001,min(.999,(v.z-1.10)/.45))) if v.y<-.025 and abs(v.x)<.18 else (.001,.001)

def gap_width(z):
    if not 1.238 < z < 1.467: return 0
    t=(z-1.238)/(1.467-1.238)
    return .072 * math.sin(math.pi*t)**.78 * (.80+.20*t)

def armhole(z):
    if not 1.394<z<1.500:return 0
    # A continuous halter edge follows a monotone shoulder-to-neck silhouette.
    # This avoids the old sinusoidal opening's indentation over the round bust.
    radius=interp(z)[0]+.0045
    width=interp(z,[(1.394,interp(1.394)[0]+.0045),(1.414,.126),
                    (1.444,.093),(1.472,.065),(1.490,.049),
                    (1.500,interp(1.500)[0]+.0045)])[0]
    return math.pi/2-math.asin(min(1,width/radius))

def dress_surface(z,t,pad=.0045):
    x,y,_=smooth_surface(z,t,pad)
    # Clearance over the rounded shoulder union at the halter armholes.
    y-=.011*math.exp(-((abs(x)-.105)/.035)**4-((z-1.433)/.030)**4)*max(0,math.cos(t))
    # A knitted skirt hugs the hips without following separate trouser legs.
    if z<1.10:
        rx,front,back=interp(z,[(.775,.171,.132,.119),(.83,.175,.135,.121),(.94,.175,.139,.123),(1.04,.151,.132,.088),(1.10,.134,.111,.071)])
        x=(rx+pad)*math.sin(t); c=math.cos(t)
        y=-(front+pad)*c if c>=0 else -(back+pad)*c
    # Shallow fabric ridges radiate from the fitted waist and lower chest.
    front=max(0,math.cos(t))**2;side=abs(math.sin(t))
    for height,amount in [(1.258,.0025),(1.282,.0018),(1.175,.0014)]:
        fold_z=height+.034*side
        y-=amount*math.exp(-((z-fold_z)/.0045)**2)*front*side
    return x,y,z

def dress_weights(v):
    if v[2] >= 1.10:return body_weights(v)
    # A single skirt stays coherent at the center as the legs move.
    if v[2] > 1.02:return {'腰':1}
    side='左' if v[0]>=0 else '右'; f=min(.45,(1.02-v[2])/.245*.45)
    return {'腰':1-f,side+'足D':f}

verts,faces,uv=[],[],[]
R,N=220,56
zs=sorted(set([.775+.725*j/(R-1) for j in range(R)]+[1.238,1.467,1.394,1.499]))
R=len(zs)
for side in (-1,1):
    for front in (True,False):
        base=len(verts)
        for j,z in enumerate(zs):
            inner=math.asin(min(.94,gap_width(z)/(interp(z)[0]+.0045))) if front else 0
            outer=math.pi/2-armhole(z)
            for i in range(N+1):
                t=inner+(outer-inner)*i/N
                if not front:t=math.pi-t
                t*=side
                verts.append(dress_surface(z,t)); uv.append(((t%(2*math.pi))/(2*math.pi),(z-.775)/.725))
        for j in range(R-1):
            for i in range(N):
                a=base+j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
dress=make_mesh('Red halter dress • shaped keyhole',verts,faces,red,dress_weights,uv,solid=0)
bm=bmesh.new();bm.from_mesh(dress.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000015)
bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(dress.data);bm.free()
bpy.context.view_layer.objects.active=dress;bpy.ops.object.select_all(action='DESELECT');dress.select_set(True)
mod=dress.modifiers.new('Knitted edge thickness','SOLIDIFY');mod.thickness=.0013;mod.offset=0
bpy.ops.object.modifier_move_up(modifier=mod.name);bpy.ops.object.modifier_apply(modifier=mod.name)

# Bound keyhole and armholes: rounded knit edges rather than cut polygon rims.
points=[]
for side in (-1,1):
    for j in range(101):
        z=1.238+.229*(j/100 if side<0 else 1-j/100)
        t=side*math.asin(min(.94,gap_width(z)/(interp(z)[0]+.0045)))
        points.append(dress_surface(z,t,.0054))
tube('Keyhole • rounded knit binding',points,.0022,trim,dress_weights,closed=True)
for side in (-1,1):
    points=[]
    for front in (True,False):
        for j in range(81):
            z=1.394+.105*(j/80 if front else 1-j/80)
            t=math.pi/2-armhole(z)
            if not front:t=math.pi-t
            points.append(dress_surface(z,side*t,.0054))
    tube('Halter armhole binding '+str(side),points,.0020,trim,dress_weights,closed=True)

# Soft folded neck ribbing: tucked lower edge, rounded turn at the top, and a
# visible inner rim so the neck sits inside the collar rather than on top.
verts,faces,uv=[],[],[];N,R=256,44
for j in range(R):
    t=j/(R-1); z=1.490+.060*t
    roll=.0018*math.exp(-((t-.10)/.08)**2)-.0011*max(0,(t-.90)/.10)
    rx=.042*(1-t)+.0355*t+.0025*math.sin(math.pi*t)+roll
    ry=.035*(1-t)+.028*t+.0025*math.sin(math.pi*t)+roll;cy=-.024*(1-t)-.030*t
    for i in range(N+1):
        th=i/N*2*math.pi; ridge=.00065*math.cos(th*68)
        verts.append(((rx+ridge)*math.sin(th),cy-(ry+ridge)*math.cos(th),z-.0025*max(0,math.cos(th))*t**5));uv.append((i/N,t))
for j in range(R-1):
    for i in range(N):a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
make_mesh('Red folded turtleneck collar',verts,faces,rib,uv=uv,solid=.0016)
for z,label in [(1.491,'Collar folded edge'),(.776,'Dress lower edge')]:
    pts=[]
    for i in range(160):
        t=i/160*2*math.pi
        pts.append((.042*math.sin(t),-.024-.036*math.cos(t),z) if z>1.4 else dress_surface(z,t,.006))
    tube(label,pts,.0018 if z>1.4 else .0013,trim,dress_weights,True)
fold_shadow=material('Stella • knit fold underside',(.30,.045,.018),(.20,.026,.010),0)
pts=[(.0425*math.sin(i/160*2*math.pi),-.024-.0368*math.cos(i/160*2*math.pi),1.489) for i in range(160)]
tube('Collar • fold underside seam',pts,.0007,fold_shadow,body_weights,True)
# Hem band has tighter, raised ribbing and a softly fitted return.
verts,faces,uv=[],[],[];N,R=160,22
for j in range(R):
    z=.777+.055*j/(R-1)
    for i in range(N+1):
        t=i/N*2*math.pi
        verts.append(dress_surface(z,t,.0055+.0006*math.cos(t*68)));uv.append((i/N,j/(R-1)))
for j in range(R-1):
    for i in range(N):a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
make_mesh('Red ribbed dress hem',verts,faces,rib,dress_weights,uv,solid=.001)

# Legs between dress hem and retained black ankle boots.
for side in (-1,1):
    verts,faces=[],[];N,R=64,96
    for j in range(R):
        z=.173+.677*j/(R-1)
        cx,cy,rx,ry=interp(z,[(.173,.068,.006,.030,.034),(.26,.073,.010,.031,.039),(.38,.079,.012,.041,.049),(.47,.079,.010,.039,.045),(.60,.078,-.018,.039,.042),(.72,.082,-.023,.051,.057),(.85,.087,-.021,.062,.077)])
        for i in range(N+1):
            t=i/N*2*math.pi;verts.append((side*cx+rx*math.sin(t),cy-ry*math.cos(t),z))
    for j in range(R-1):
        for i in range(N):a=j*(N+1)+i;faces.append((a,a+1,a+N+2,a+N+1))
    make_mesh('Stella • bare leg '+str(side),verts,faces,skin,trouser_weights)

# Remove covered torso skin instead of letting it intersect the fitted knit.
# Keep a narrow underlap at openings; arms, neck and the exposed chest remain.
def exposed_skin(v):
    x,y,z=v
    if abs(x)>.165 or z>1.503:return True
    if y<0 and 1.234<z<1.471 and abs(x)<gap_width(z)+.0028:return True
    if 1.391<z<1.503:
        zz=max(1.394,min(1.5,z))
        edge=(interp(zz)[0]+.0045)*math.cos(armhole(zz))
        if abs(x)>edge-.0028:return True
    return False
old_normals=[tuple(v.normal) for v in body.data.vertices]
bm=bmesh.new();bm.from_mesh(body.data)
remove=[f for f in bm.faces if not any(exposed_skin(v.co) for v in f.verts)]
bmesh.ops.delete(bm,geom=remove,context='FACES_ONLY')
bm.to_mesh(body.data);bm.free()
# Restore the authored normals after changing surface visibility.
if len(body.data.vertices)==len(custom):body.data.normals_split_custom_set_from_vertices(custom)

meta=arm.data.vrm_addon_extension.vrm1.meta
meta.vrm_name='Stella • red keyhole knit dress';meta.version='1.2-knit-tailoring'
meta.copyright_information+=' Custom red halter knit outfit for personal local Stella use.'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            s=area.spaces.active;s.overlay.show_overlays=False;s.shading.type='MATERIAL'
            s.region_3d.view_rotation=Quaternion((1,0,0),math.pi/2)
            s.region_3d.view_perspective='ORTHO';s.region_3d.view_location=(0,0,1.30);s.region_3d.view_distance=1.65
bpy.ops.object.select_all(action='DESELECT')
for obj in bpy.context.scene.objects:
    if obj==arm or obj.type=='MESH' and any(m.type=='ARMATURE' and m.object==arm for m in obj.modifiers):
        obj.hide_set(False);obj.select_set(True)
bpy.context.view_layer.objects.active=arm
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'stella-red-keyhole.blend'))
arm.data.pose_position='REST';bpy.context.view_layer.update()
result=bpy.ops.export_scene.vrm(filepath=str(OUT/'stella-red-keyhole.vrm'),armature_object_name=arm.name,export_only_selections=False,export_invisibles=True,export_all_influences=True,ignore_warning=True)
assert result=={'FINISHED'}
file=OUT/'stella-red-keyhole.vrm';data=file.read_bytes();jlen=struct.unpack_from('<I',data,12)[0];gltf=json.loads(data[20:20+jlen])
for mat in gltf['materials']:
    if mat['name'] in [red.name,rib.name]:
        mat.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=[.61,.085,.035,1]
        mat['emissiveFactor']=[.035,.004,.0005]
encoded=json.dumps(gltf,separators=(',',':'),ensure_ascii=False).encode();encoded+=b' '*((-len(encoded))%4)
tail=data[20+jlen:];file.write_bytes(struct.pack('<III',0x46546C67,2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4E4F534A)+encoded+tail)
print('RED_KEYHOLE_EXPORTED',str(file))
