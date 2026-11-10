# Her second set of expressions, designed for who she is: mostly small movements, where she looks, one-sided mouths, and now and then a big feeling at full strength.
# Each entry: keys = shape key -> percent; mouth = False hides the sculpted mouth and shows the drawn line of the same name (expr2_draw.py);
# overlays = [(picture on her skin, strength)]; water = True lays the water drawn for this expression over her eyes, fitted to its lids (expr2_lids.py), and "back" lays it under her eye layers but over her star; iris = how bright her irises are (1 is normal).
# Gaze_L is toward her left (the right of a front view), and 100 turns the eyes 20 degrees.
REST = {"Fcl_EYE_Close": 20}  # her resting lid, as in her neutral


def lids(amount, **more):
    return {"Fcl_EYE_Close": amount, **more}


EXPRESSIONS = {
    # Her everyday: the brief's most common faces, cool and dry.
    "observing": dict(keys=lids(20, Gaze_L=70, Gaze_Down=8), mouth=False),
    "deadpan": dict(keys=lids(38, Eye_UpperLid_In_L=100, Eye_UpperLid_In_R=100, browDownLeft=22, browDownRight=22), mouth=False),
    "side_eye": dict(keys=lids(32, Gaze_L=135, browDownLeft=40, browOuterUpRight=22), mouth=False),
    "eye_roll": dict(keys=lids(28, Gaze_Up=105, Gaze_R=25, browOuterUpRight=20, browDownLeft=10), mouth=False),
    "skeptical": dict(keys=lids(20, browOuterUpLeft=55, Brow_Tilt_L=25, browDownRight=45, eyeSquintRight=45, Gaze_R=10), mouth=False),
    "smirk": dict(keys=lids(34, browOuterUpLeft=38, browDownRight=26, eyeSquintLeft=14), mouth=False),
    "amused": dict(keys={"Fcl_EYE_Close": 14, "eyeSquint+LowerUp_L": 50, "eyeSquint+LowerUp_R": 50, "cheekSquintLeft": 40, "cheekSquintRight": 40, "Brow_Joy": 18, "browOuterUpLeft": 18}, mouth=False),
    # Curious: she wanders into what she is looking at.
    "curious": dict(keys=dict(Fcl_EYE_Close=4, Eye_Spread=38, Eye_Iris_Size=-14, Highlight_Big=40, Gaze_L=46, Gaze_Up=18, browOuterUpLeft=36, browInnerUp_L=12, Mouth_O=20, Mouth_A=10, Mouth_Small=40)),
    "thinking": dict(keys=lids(20, Gaze_Up=52, Gaze_R=72, Brow_Tilt_R=-32, browDownLeft=24, eyeSquintLeft=18), mouth=False),
    "realizing": dict(keys=dict(Eye_Spread=78, Eye_Surprised=36, Eye_Iris_Size=6, Brow_Surprised=46, Mouth_O=40, Mouth_Surprised=20, Mouth_Small=20)),
    "wonder": dict(keys=dict(Eye_Spread=70, Eye_Iris_Size=-16, Highlight_Big=80, Gaze_Up=48, Gaze_L=18, browInnerUp=30, Brow_Surprised=28, Mouth_A=22, Mouth_Small=30)),
    # Warm: slow to show, real when it does.
    "soft_smile": dict(keys={"Eye_Spread": 22, "Eye_Fun": 16, "eyeSquint+LowerUp_L": 16, "eyeSquint+LowerUp_R": 16, "Highlight_Big": 55, "Brow_Joy": 22}, mouth=False),
    "fond": dict(keys=dict(Eye_Joy=100, Brow_Joy=26, browInnerUp=26), mouth=False),
    "laugh": dict(keys=dict(Eye_Joy=100, Brow_Sorrow=20, Brow_Joy=30, Mouth_Joy=100, jawOpen=18, mouthSmileLeft=40, Teeth_Vampire_Up=70)),
    # Flustered: she loses her composure and looks away from it.
    "flustered": dict(keys=dict(Eye_Spread=26, Eye_Sorrow=46, Gaze_R=100, Gaze_Down=34, browInnerUp=46, browDownLeft=12, browDownRight=12), mouth=False, overlays=[("s2_blush_uv.png", 1.0)]),
    "shy": dict(keys=dict(Fcl_EYE_Close=28, Gaze_Down=78, Gaze_R=34, Brow_Sorrow=28), mouth=False, overlays=[("s2_blush_light_uv.png", 1.0)]),
    "startled": dict(keys=dict(Eye_Surprised=128, Eye_Iris_Size=24, Brow_Surprised=82, Mouth_Surprised=62, Teeth_Hide_Low=40)),
    # Hurt: quiet, honest, and she always comes back.
    "quiet_hurt": dict(keys=dict(Fcl_EYE_Close=40, Gaze_Down=86, Gaze_R=70, Eye_Highlight_Hide=100, browInnerUp=30, browDownLeft=16, browDownRight=16), mouth=False, iris=0.42),
    "teary": dict(keys={"Eye_Sorrow": 50, "Fcl_EYE_Close": 6, "Highlight_Big": 100, "Gaze_Down": 12, "browInnerUp": 66, "browDownLeft": 16, "browDownRight": 16, "eyeSquint+LowerUp_L": 12, "eyeSquint+LowerUp_R": 12}, mouth=False, water=True, overlays=[("s2_flush_uv.png", 1.0)]),
    "weeping": dict(keys={"Eye_Sorrow": 62, "Fcl_EYE_Close": 14, "Highlight_Big": 100, "Gaze_Down": 14, "browInnerUp": 78, "browDownLeft": 18, "browDownRight": 18, "eyeSquint+LowerUp_L": 14, "eyeSquint+LowerUp_R": 14, "Mouth_A": 24, "mouthFrown": 100, "Mouth_Small": 30}, water="back", overlays=[("s2_flush_uv.png", 1.0)]),
    "sorry": dict(keys=dict(Brow_Sorrow=70, Fcl_EYE_Close=30, Gaze_Down=48, Gaze_R=10), mouth=False),
    # Opinionated and tired.
    "annoyed": dict(keys=lids(14, Eye_Angry=130, browDownLeft=72, browDownRight=72, Brow_Tilt=46, Gaze_R=24), mouth=False),
    "opinion": dict(keys=lids(16, browOuterUpLeft=30, browDownRight=22, Mouth_A=44, Mouth_E=30, Mouth_Small=14)),
    "sigh": dict(keys=dict(eyeBlink=100, Brow_Sorrow=44, mouthFunnel=46, Mouth_A=14)),
    "drowsy": dict(keys=dict(Fcl_EYE_Close=68, Gaze_Down=40, Brow_Tilt=-24, browDownLeft=8, browDownRight=8), mouth=False),
    # Big feelings: rarer than the rest, and not held back when they come.
    "pout": dict(keys=dict(cheekPuff=120, Fcl_EYE_Close=16, Gaze_R=92, Gaze_Down=10, browInnerUp=26, browDownLeft=30, browDownRight=30), mouth=False, mouth_forward=0.014, overlays=[("s2_blush_light_uv.png", 1.0)]),
    "angry": dict(keys=dict(Eye_Angry=220, Eye_Iris_Size=12, Brow_Tilt=85, browDownLeft=85, browDownRight=85, Mouth_A=70, mouthStretchLeft=100, mouthStretchRight=100, mouthUpperUpLeft=90, mouthUpperUpRight=90, mouthFrown=60, jawOpen=6, Teeth_Vampire=100)),
    "frightened": dict(keys=dict(Eye_Spread=150, Eye_Surprised=40, Eye_Iris_Size=55, browInnerUp=90, browDownLeft=20, browDownRight=20, Mouth_E=100, mouthStretchLeft=100, mouthStretchRight=100, mouthFrown=60, Teeth_Hide_Up=-50, Teeth_Hide_Low=-50), overlays=[("s2_fright_uv.png", 0.5)]),
    "cry": dict(keys=dict(eyeBlink=100, Brow_Sorrow=100, browInnerUp=60, Mouth_A=100, mouthFrown=100, mouthStretchLeft=80, mouthStretchRight=80, jawOpen=15), overlays=[("s2_cry_uv.png", 1.0)]),
    "tongue_focus": dict(keys=dict(Fcl_EYE_Close=16, eyeSquintLeft=22, eyeSquintRight=22, Eye_Iris_Size=8, Gaze_Down=24, browDownLeft=46, browDownRight=46, Brow_Tilt=24), mouth=False),
    "tongue_mischief": dict(keys=dict(Fcl_EYE_Close=30, Gaze_Down=55, Gaze_L=30, browDownLeft=40, browDownRight=40, Brow_Tilt=18, mouthLeft=55, Mouth_A=22, tongueOut=55, Mouth_Small=30, Teeth_Hide=100)),
    # She has read how humans smile. The mouth is right; nothing else has been told.
    "practising_smile": dict(keys=lids(20, Mouth_I=70, Mouth_E=60, Mouth_O=15, mouthSmile2_L=60, mouthSmile2_R=30)),
}
