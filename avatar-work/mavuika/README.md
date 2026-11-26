# Mavuika appearance for Stella

Converted from the complete official PMX downloaded by the user from
https://aplaybox.com/details/model/UGujbE7o5fxR on 12 September 2026.

Character/model: miHoYo / 原神. PMX conversion: 观海 (Guanhai).
The original usage terms are in `source/readme【一定要看】.txt` and embedded
in the VRM metadata. This is a personal local conversion; do not redistribute
the model or use it commercially.

## Files

The red halter knit dress is in `outfits/red-keyhole/`, with a packed Blender
source, exported VRM, previous-avatar backup and renderer checks. Its builder
is `../create_keyhole_outfit.py`.

The separately preserved laboratory outfit is in `outfits/lab-coat/`, with an editable
Blender project, exported VRM, previous-avatar backup and renderer checks.
See `outfits/lab-coat/README.md`; its base builder is
`../create_lab_outfit.py`, followed by the documented live visual-tailoring pass.

- `mavuika-stella.vrm`: self-contained VRM 1.0 imported into the installed Stella app.
- `mavuika-stella.blend`: editable T-pose character with packed textures, humanoid mapping, expressions and hair springs.
- `mavuika-source.blend`: original PMX import before conversion.
- `original-stella.vrm`: backup of the previous bundled Stella avatar.
- `preview-*.png`: actual Electron/Three.js renders of relaxed, crossed, wave, speaking and blink states.
- `render-check.json` / `install-check.json`: runtime error check and installed-file verification.

Blinking, vowel mouth shapes, relaxed/crossed poses, waving and head-to-torso
framing were checked in Stella's renderer. The imported model has 54 mapped
humanoid bones. Its large ornamental cuffs overlap in the existing crossed-arm
pose; relaxed and waving poses give the sleeves more room. Hair springs are
gentle and do not include body collision volumes.

## Rebuild

From the Stella project directory, use Blender 5.2 with the project-local
VRM 4.7.1 and MMD Tools 4.5.14 addons in `../tools`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python avatar-work/import_mavuika.py
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python-exit-code 1 --python avatar-work/convert_mavuika.py
```

The conversion preserves the complete character geometry and morphs, bakes
the A-pose into a T-pose, maps the humanoid skeleton, replaces MMD shaders with
MToon materials, embeds textures and credits, and adds gentle hair springs.
It does not run the source's optional external shader files or modify the
user's global Blender preferences.

To switch avatars in Stella, open the workspace, choose **Change avatar**,
and select the desired `.vrm`. The original bundled asset is also unchanged
at `../../assets/stella.vrm`.
