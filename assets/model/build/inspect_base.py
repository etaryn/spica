"""Imports the base model and prints what it holds. Run: blender -b -P inspect_base.py"""
import bpy, os
bpy.ops.wm.read_factory_settings(use_empty=True)
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bpy.ops.import_scene.gltf(filepath=os.path.join(root, "base", "sample_model.glb"))
objs = list(bpy.data.objects)
print("OBJECTS", len(objs), {t: sum(1 for o in objs if o.type == t) for t in {o.type for o in objs}})
for o in objs:
    if o.type == "MESH" and not o.name.startswith("Hair0"):
        me = o.data
        print("MESH", o.name, "verts", len(me.vertices), "polys", len(me.polygons), "dim", tuple(round(x, 3) for x in o.dimensions),
              "mats", [m.name for m in me.materials], "shapekeys", len(me.shape_keys.key_blocks) if me.shape_keys else 0)
hair = [o for o in objs if o.name.startswith("Hair0")]
print("HAIR", len(hair), "total polys", sum(len(o.data.polygons) for o in hair))
arm = [o for o in objs if o.type == "ARMATURE"]
print("ARM", [(a.name, len(a.data.bones)) for a in arm])
for a in arm:
    print([b.name for b in a.data.bones if not b.name.startswith("J_Sec_Hair")][:80])
f = bpy.data.objects.get("Face")
if f and f.data.shape_keys:
    print("SHAPEKEYS", [k.name for k in f.data.shape_keys.key_blocks])
print("MATS", [m.name for m in bpy.data.materials])
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root, "base", "sample_import.blend"))
