"""
Her expressions as data (plain Python, importable from Blender and Pillow). Each entry:
  keys      shape key -> percent (the Expression Pack's own presets drive them; see face_keys.py and assets/references/pack_presets.json,
            e.g. Eye Happy 3 = Eye_Joy 100 + Brow_Joy 100; values past 100 or below 0 are part of the presets)
  overlays  [(picture in assets/model/tex/face, strength)] laid on her face skin by UV (blush, gloom, eyebags, forehead lines)
  mesh_mouth  False hides the sample's mouth (a flat closed mouth collapses to nothing on the mesh, so those use the drawn line)
  hide      ("brows",): the sample's brows are not shown (unused now; for a later doodle)
  decal     True: a small drawn picture of the same name (expr_draw.py): the mouth lines, tears, blush marks
Doodles (thick unstable black lines) were tried and removed by Ethan; they will be worked on later.
"""

SHADE = ("shade_hard.png", 0.5)  # a navy shadow over the upper face with a hard boundary (the pack's Shade 1, cut at one level; expr_draw.py)

EXPRESSIONS = {
    "neutral": dict(keys={"Fcl_EYE_Close": 20}, mesh_mouth=False, decal=True),
    # happy: closed arches (Eye Happy 3), an open grin with canines leaning in (Teeth_Vampire_Up)
    "happy": dict(keys={"Eye_Joy": 100, "Brow_Joy": 100, "Mouth_Joy": 100, "Teeth_Vampire_Up": 100}),
    "laugh": dict(keys={"Eye_Joy": 100, "Brow_Joy": 100, "Mouth_A": 100, "Mouth_Fun": 60, "jawOpen": 15, "Teeth_Vampire_Up": 100}),
    # soft_smile: the rare payoff: eyes open a little wider, a soft thin line smile (drawn, like the neutral line)
    "soft_smile": dict(keys={"Eye_Spread": 30, "Eye_Fun": 25, "Brow_Joy": 30}, mesh_mouth=False, decal=True),
    # smug: a closed lens smile with smiling eyes (this was the first soft_smile; it reads smug, so Ethan named it that)
    "smug": dict(keys={"Eye_Fun": 100, "Brow_Fun": 40, "Mouth_Fun": 150, "Mouth_Joy": 25, "Teeth_Hide": 100}),
    # smirk: half-lidded, one brow up, an asymmetric closed smirk (Mouth Smirk 2 with mouthSmileLeft / mouthLeft)
    "smirk": dict(keys={"Brow_Tilt_L": 60, "Brow_Tilt_R": 25, "browDownRight": 50, "eyeBlink": 30, "eyeBlinkRight": 25, "Mouth_Fun": 150, "Mouth_Joy": 25, "mouthSmileLeft": 100, "mouthLeft": 60}),
    "devious": dict(keys={"Brow_Tilt": 60, "Eye_Angry": 100, "browDownLeft": 60, "browDownRight": 60, "eyeBlink": 30, "Mouth_Large": 15, "Mouth_Fun": 100, "Mouth_A": 100, "Teeth_Shark": 100}),
    "teasing": dict(keys={"Eye_Fun": 100, "Brow_Fun": 100, "eyeBlinkRight": 40, "Mouth_Joy": 100, "tongueOut": 100, "Teeth_Vampire_Up": 100}),
    "wink": dict(keys={"Brow_Tilt_L": 60, "Eye_Position_Height_R": 25, "Eye_Joy_R": 100, "eyeBlinkLeft": 15, "browDownLeft": 40, "browDownRight": 90, "Mouth_Joy": 100, "Teeth_Vampire_Up": 100}),
    "angry": dict(keys={"Brow_Tilt": 60, "Eye_Angry": 250, "browDownLeft": 60, "browDownRight": 60, "mouthFrown": 100, "Mouth_I": 100, "mouthUpperUpLeft": 150, "mouthUpperUpRight": 150, "Teeth_Hide_Low": -50}),
    "furious": dict(keys={"Brow_Tilt": 80, "Eye_Angry": 250, "browDownLeft": 80, "browDownRight": 80, "mouthFrown": 100, "Mouth_A": 100, "mouthStretchLeft": 100, "mouthStretchRight": 100, "mouthUpperUpLeft": 100, "mouthUpperUpRight": 100, "Teeth_Vampire": 100}),
    # sad (the new one) and sad_old (the first one) are both kept
    "sad": dict(keys={"Eye_Sorrow": 200, "Eye_Spread": 100, "Eye_Iris_Size": 100, "Brow_Tilt": -75, "browDownLeft": 60, "browDownRight": 60, "Mouth_A": 40, "mouthFrown": 100, "mouthStretchLeft": 60, "mouthStretchRight": 60}),
    "sad_old": dict(keys={"Eye_Surprised": 50, "Eye_Sorrow_R": 150, "Eye_Sorrow_L": 150, "Brow_Tilt": -75, "browDownLeft": 80, "browDownRight": 80, "mouthFrown": 100}),
    "pout": dict(keys={"cheekPuff": 100, "Eye_Angry": 60, "Brow_Tilt": 30, "browDownLeft": 30, "browDownRight": 30, "Mouth_U": 60, "mouthFrown": 60}),
    "cross_eyed": dict(keys={"eyeLookInLeft": 100, "eyeLookInRight": 100, "Brow_Sorrow": 60}, mesh_mouth=False, decal=True),
    "hurt": dict(keys={"Brow_Sorrow": 100, "eyeBlinkLeft": 100, "eyeBlinkRight": 100, "browDownLeft": 45, "browDownRight": 45, "Mouth_A": 25, "mouthFrown": 100, "mouthStretchLeft": 40, "mouthStretchRight": 40}),
    "cry": dict(keys={"eyeBlink": 100, "Brow_Sorrow": 100, "Mouth_A": 80, "mouthFrown": 100, "mouthStretchLeft": 100, "mouthStretchRight": 100}, overlays=[("cry_uv.png", 1.0)]),
    # blush is drawn on the decal (expr_draw.py): a soft blended glow with //// lines on top (Ethan's pick, 2026-11-09)
    "flustered": dict(keys={"Eye_Surprised": 80, "Eye_Sorrow_R": 130, "Eye_Sorrow_L": 200, "Brow_Tilt": -75, "Mouth_I": 70, "Mouth_E": 60, "Mouth_O": 15}, decal=True),
    "shy": dict(keys={"Eye_Sorrow": 80, "Brow_Sorrow": 60, "eyeLookDownLeft": 60, "eyeLookDownRight": 60, "Mouth_Fun": 60}, decal=True),
    "surprised": dict(keys={"Eye_Surprised": 150, "Brow_Surprised": 100, "Mouth_Surprised": 100}),
    "frightened": dict(keys={"Brow_Tilt": -75, "Eye_Spread": 150, "Eye_Iris_Size": -25, "browDownLeft": 15, "browDownRight": 15, "Mouth_E": 100, "mouthStretchLeft": 100, "mouthStretchRight": 100, "Teeth_Hide_Up": -50, "Teeth_Hide_Low": -50, "mouthFrown": 60}, overlays=[SHADE]),
    "confused": dict(keys={"Brow_Tilt_L": 60, "Brow_Tilt_R": -40, "browDownRight": 50, "eyeSquintLeft": 30}, mesh_mouth=False, decal=True),
    "disappointed": dict(keys={"Brow_Tilt": -20, "Eye_UpperLid_In_L": 100, "Eye_UpperLid_In_R": 100, "browDownLeft": 65, "browDownRight": 65, "eyeBlink": 40, "mouthFrown": 100}),
    "bored": dict(keys={"Brow_Tilt": -20, "Eye_UpperLid_In_L": 100, "Eye_UpperLid_In_R": 100, "eyeBlink": 40, "browDownLeft": 65, "browDownRight": 65}, mesh_mouth=False, decal=True),
    "sleepy": dict(keys={"Brow_Tilt": -20, "Eye_UpperLid_In_L": 100, "Eye_UpperLid_In_R": 100, "eyeBlink": 60, "Mouth_O": 20}, overlays=[("eyebags_1.png", 0.18)]),
}
