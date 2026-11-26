from pathlib import Path
import sys,json
import bpy
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT))
from blender_bootstrap import enable_tools
bpy.ops.wm.read_factory_settings(use_empty=True)
enable_tools()
result=bpy.ops.mmd_tools.import_model(filepath=str(ROOT/'mavuika/source/玛薇卡.pmx'),scale=.08,types={'MESH','ARMATURE','MORPHS'},rename_bones=False,clean_model=False,remove_doubles=False)
assert result=={'FINISHED'},result
report={'objects':[],'bones':[],'materials':[]}
for o in bpy.context.scene.objects:
 entry={'name':o.name,'type':o.type,'dimensions':list(o.dimensions)}
 if o.type=='MESH':
  entry.update(vertices=len(o.data.vertices),polygons=len(o.data.polygons),shapes=[k.name for k in o.data.shape_keys.key_blocks] if o.data.shape_keys else [],materials=[m.name for m in o.data.materials])
 if o.type=='ARMATURE':
  for b in o.data.bones:report['bones'].append({'name':b.name,'parent':b.parent.name if b.parent else None,'head':list(b.head_local),'tail':list(b.tail_local)})
 report['objects'].append(entry)
for m in bpy.data.materials:
 report['materials'].append({'name':m.name,'diffuse':list(m.diffuse_color),'textures':[(n.name,n.image.filepath if n.image else None) for n in m.node_tree.nodes if n.type=='TEX_IMAGE'] if m.node_tree else []})
(ROOT/'mavuika/import-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'mavuika/mavuika-source.blend'))
print('MAVUIKA_IMPORTED',[(o['name'],o['type']) for o in report['objects']])
