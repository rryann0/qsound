# Renders the chrome QSound wordmark in Blender.
#
#   blender --background --python scripts/make_logo.py -- <font.ttf> <studio.hdr> <out.png>

import math
import sys

import bpy

font_path, hdr_path, out_path = sys.argv[sys.argv.index("--") + 1 :][:3]

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
prefs = bpy.context.preferences.addons["cycles"].preferences
try:
    prefs.compute_device_type = "METAL"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = "GPU"
except Exception:
    scene.cycles.device = "CPU"

curve = bpy.data.curves.new("word", "FONT")
curve.body = "QSound"
curve.font = bpy.data.fonts.load(font_path)
curve.size = 1
curve.align_x = "CENTER"
curve.align_y = "CENTER"
curve.extrude = 0.13
curve.bevel_depth = 0.03
curve.bevel_resolution = 6
curve.resolution_u = 20
word = bpy.data.objects.new("word", curve)
bpy.context.collection.objects.link(word)

chrome = bpy.data.materials.new("chrome")
chrome.use_nodes = True
bsdf = chrome.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.93, 0.96, 1, 1)
bsdf.inputs["Metallic"].default_value = 1
bsdf.inputs["Roughness"].default_value = 0.05
curve.materials.append(chrome)

world = bpy.data.worlds.new("studio")
scene.world = world
world.use_nodes = True
nodes = world.node_tree
env = nodes.nodes.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(hdr_path)
mapping = nodes.nodes.new("ShaderNodeMapping")
mapping.inputs["Rotation"].default_value = (0, 0, math.radians(140))
coords = nodes.nodes.new("ShaderNodeTexCoord")
nodes.links.new(coords.outputs["Generated"], mapping.inputs[0])
nodes.links.new(mapping.outputs[0], env.inputs[0])
nodes.links.new(env.outputs[0], nodes.nodes["Background"].inputs[0])

camera_data = bpy.data.cameras.new("cam")
camera_data.lens = 90
camera = bpy.data.objects.new("cam", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (0, -3.9, 10)
camera.rotation_euler = (math.radians(21.3), 0, 0)
scene.camera = camera

scene.render.resolution_x = 1280
scene.render.resolution_y = 300
scene.render.film_transparent = True
scene.cycles.samples = 128
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = out_path
bpy.ops.render.render(write_still=True)
