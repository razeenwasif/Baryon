#!/usr/bin/env python3
import os
from collections import deque
import numpy as np
from PIL import Image

def extract_all():
    assets_dir = os.environ.get('BARYON_ASSETS_DIR', './assets')
    src_path = os.path.join(assets_dir, '87951696-6438-47e2-ba1c-0f3bf7544b15.png')
    out_dir = assets_dir
    os.makedirs(out_dir, exist_ok=True)

    im = Image.open(src_path)
    print('Loaded source image:', im.size)

    # 5 poses defined by (name, x1, x2, y1, y2)
    # y1=45 captures halo comfortably, y2=675 captures sandals
    poses = [
        ('fairy-sprite.png', 27, 350, 42, 675, 'idle'),
        ('fairy-dancing.png', 379, 686, 42, 675, 'dancing'),
        ('fairy-waving.png', 687, 1043, 42, 675, 'waving'),
        ('fairy-thinking.png', 1065, 1379, 42, 675, 'thinking'),
        ('fairy-speaking.png', 1392, 1755, 42, 675, 'speaking'),
    ]

    CANVAS_W = 420
    CANVAS_H = 760
    TARGET_BASELINE_Y = 700  # Ground baseline where sandals rest

    for filename, x1, x2, y1, y2, pose_type in poses:
        crop = im.crop((x1, y1, x2, y2))
        arr = np.array(crop)
        H, W, _ = arr.shape

        # 1. External flood-fill transparency
        bg_mask = np.all(arr >= 238, axis=2)
        visited = np.zeros((H, W), dtype=bool)
        q = deque()

        # Seed from 4 borders
        for x in range(W):
            if bg_mask[0, x]: q.append((0, x)); visited[0, x] = True
            if bg_mask[H-1, x]: q.append((H-1, x)); visited[H-1, x] = True
        for y in range(H):
            if bg_mask[y, 0] and not visited[y, 0]: q.append((y, 0)); visited[y, 0] = True
            if bg_mask[y, W-1] and not visited[y, W-1]: q.append((y, W-1)); visited[y, W-1] = True

        while q:
            y, x = q.popleft()
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < H and 0 <= nx < W and not visited[ny, nx]:
                    if np.all(arr[ny, nx] >= 235):
                        visited[ny, nx] = True
                        q.append((ny, nx))

        # 2. Inside the halo ring (y < 60), clear the hollow center if trapped
        halo_region = (~visited) & (np.arange(H)[:, None] < 55) & np.all(arr >= 242, axis=2)
        for y in range(min(55, H)):
            for x in range(W):
                if halo_region[y, x] and not visited[y, x]:
                    # check if this is an enclosed white pocket in halo
                    visited[y, x] = True
                    hq = deque([(y, x)])
                    while hq:
                        cy, cx = hq.popleft()
                        for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
                            nny, nnx = cy + dy, cx + dx
                            if 0 <= nny < 55 and 0 <= nnx < W and not visited[nny, nnx] and np.all(arr[nny, nnx] >= 235):
                                visited[nny, nnx] = True
                                hq.append((nny, nnx))

        # 3. Label foreground components to drop detached text / side noise
        solid = ~visited
        labeled = np.zeros((H, W), dtype=int)
        cid = 0
        comp_sizes = {}
        for y in range(H):
            for x in range(W):
                if solid[y, x] and labeled[y, x] == 0:
                    cid += 1
                    cq = deque([(y, x)])
                    labeled[y, x] = cid
                    size = 0
                    while cq:
                        cy, cx = cq.popleft()
                        size += 1
                        for dy, dx in ((-1,0), (1,0), (0,-1), (0,1)):
                            nny, nnx = cy + dy, cx + dx
                            if 0 <= nny < H and 0 <= nnx < W and solid[nny, nnx] and labeled[nny, nnx] == 0:
                                labeled[nny, nnx] = cid
                                cq.append((nny, nnx))
                    comp_sizes[cid] = size

        # Determine which components to keep:
        # - Main character body is the largest component (> 50,000 px)
        # - Floating halo is at y < 80, size >= 500 px
        # - Floating music notes (in dancing pose): size between 80 and 800 at y < 200
        # - Detached text on margins (x < 45 or x > 310) is excluded
        keep_mask = np.zeros((H, W), dtype=bool)
        for c, sz in comp_sizes.items():
            ys, xs = np.where(labeled == c)
            ymin, ymax = ys.min(), ys.max()
            xmin, xmax = xs.min(), xs.max()

            # Main body
            if sz > 40000:
                keep_mask[labeled == c] = True
            # Floating halo
            elif ymax < 80 and sz >= 400 and (xmin > 40 and xmax < W - 40):
                keep_mask[labeled == c] = True
            # In dancing pose, keep music notes
            elif pose_type == 'dancing' and ymax < 180 and sz >= 100 and (xmin > 15 and xmax < W - 15):
                keep_mask[labeled == c] = True

        # Construct RGBA
        rgba = np.zeros((H, W, 4), dtype=np.uint8)
        rgba[:, :, :3] = arr
        rgba[:, :, 3] = np.where(keep_mask, 255, 0)

        # 4. Find tight bounding box of kept pixels
        ys, xs = np.where(keep_mask)
        if len(ys) == 0:
            print(f'Error: no pixels kept for {filename}!')
            continue
        ymin, ymax = ys.min(), ys.max()
        xmin, xmax = xs.min(), xs.max()

        char_crop = rgba[ymin:ymax+1, xmin:xmax+1]
        char_h, char_w = char_crop.shape[:2]

        # 5. Place on unified canvas (CANVAS_W x CANVAS_H)
        # Align feet at TARGET_BASELINE_Y
        dest_y = TARGET_BASELINE_Y - char_h
        dest_x = (CANVAS_W - char_w) // 2

        canvas = np.zeros((CANVAS_H, CANVAS_W, 4), dtype=np.uint8)
        # Clip placement if needed
        sy1 = max(0, -dest_y)
        sy2 = min(char_h, CANVAS_H - dest_y)
        sx1 = max(0, -dest_x)
        sx2 = min(char_w, CANVAS_W - dest_x)

        dy1 = max(0, dest_y)
        dy2 = dy1 + (sy2 - sy1)
        dx1 = max(0, dest_x)
        dx2 = dx1 + (sx2 - sx1)

        canvas[dy1:dy2, dx1:dx2] = char_crop[sy1:sy2, sx1:sx2]

        # 6. Scale 2x with nearest neighbor to 840x1520 for high-DPI pixel perfection
        img_1x = Image.fromarray(canvas)
        img_2x = img_1x.resize((CANVAS_W * 2, CANVAS_H * 2), Image.NEAREST)

        dest_file = os.path.join(out_dir, filename)
        img_2x.save(dest_file)
        print(f'Successfully saved {dest_file} ({img_2x.size[0]}x{img_2x.size[1]})')

if __name__ == '__main__':
    extract_all()
