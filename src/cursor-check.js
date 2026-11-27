// Efficiency audit, fix 6: how soon the companion checks the cursor again. Each check is a round trip to the main
// process, so it's often while the pointer is on the window or near it, and a few times a second while it's far away.
export const CURSOR_NEAR_PX = 160, CURSOR_NEAR_MS = 60, CURSOR_FAR_MS = 250;
export const cursorCheckDelay = (point, width, height) => point && point.x >= -CURSOR_NEAR_PX && point.y >= -CURSOR_NEAR_PX
  && point.x <= width + CURSOR_NEAR_PX && point.y <= height + CURSOR_NEAR_PX ? CURSOR_NEAR_MS : CURSOR_FAR_MS;
