// Full screen around the notch, for Fairy's window (as Tachyon does it): the window covers the whole screen, the menu bar
// and Dock tuck away while Fairy is in front, and the page puts its band either side of the notch. Electron can't put a
// window over the menu bar's place or say where the notch is, so this small Node-API module does both, in the main
// process.
//
// Built by `npm run build:notch` into native/bin/fairy-notch.node. Every call takes the window's native handle
// (BrowserWindow.getNativeWindowHandle(), an NSView pointer) and must run on the main thread, which Electron's main
// process JavaScript does.
#import <AppKit/AppKit.h>
#include <node_api.h>

static NSWindow *windowFrom(napi_env env, napi_value value) {
  void *data = NULL;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok || length < sizeof(void *)) return nil;
  NSView *view = (__bridge NSView *)(*(void **)data);
  return [view isKindOfClass:[NSView class]] ? view.window : nil;
}

static napi_value number(napi_env env, double value) {
  napi_value result;
  napi_create_double(env, value, &result);
  return result;
}

static napi_value argument(napi_env env, napi_callback_info info) {
  size_t count = 1;
  napi_value args[1] = { NULL };
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  return count ? args[0] : NULL;
}

// Where the band goes on the window's screen, in points: its height (the notch's, or the menu bar's on a screen without
// one) and how wide the spaces left and right of the notch are.
static napi_value geometry(napi_env env, napi_callback_info info) {
  napi_value handle = argument(env, info), result;
  NSWindow *window = handle ? windowFrom(env, handle) : nil;
  NSScreen *screen = window.screen ?: NSScreen.mainScreen;
  napi_get_null(env, &result);
  if (!screen) return result;
  NSRect frame = screen.frame;
  CGFloat notch = 0, left = 0, right = 0;
  if (@available(macOS 12.0, *)) {
    notch = screen.safeAreaInsets.top;
    left = screen.auxiliaryTopLeftArea.size.width;
    right = screen.auxiliaryTopRightArea.size.width;
  }
  CGFloat bar = MAX(NSStatusBar.systemStatusBar.thickness, NSMaxY(frame) - NSMaxY(screen.visibleFrame));
  BOOL hasNotch = notch > 0 && left > 0 && right > 0;
  napi_create_object(env, &result);
  napi_value yes;
  napi_get_boolean(env, hasNotch, &yes);
  napi_set_named_property(env, result, "notch", yes);
  napi_set_named_property(env, result, "band", number(env, hasNotch ? notch : MIN(MAX(bar, 24), 40)));
  napi_set_named_property(env, result, "width", number(env, frame.size.width));
  napi_set_named_property(env, result, "left", number(env, hasNotch ? left : 0));
  napi_set_named_property(env, result, "right", number(env, hasNotch ? right : 0));
  return result;
}

// present(true) tucks the menu bar and Dock away while Fairy is in front; present(true, true) only the Dock, leaving
// the menu bar over the top of the window (which then shows its own copy of the desktop picture, not the window);
// present(false) puts them back. Like macOS's own full screen, what's
// tucked away slides back over the window while the pointer is at its edge, and everything shows again by itself while
// another app is in front.
static napi_value present(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2] = { NULL, NULL }, result;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  bool hide = false, keepMenuBar = false;
  if (count > 0) napi_get_value_bool(env, args[0], &hide);
  if (count > 1) napi_get_value_bool(env, args[1], &keepMenuBar);
  bool done = true;
  @try {
    NSApp.presentationOptions = !hide ? NSApplicationPresentationDefault
      : keepMenuBar ? NSApplicationPresentationAutoHideDock
      : (NSApplicationPresentationAutoHideDock | NSApplicationPresentationAutoHideMenuBar);
  } @catch (NSException *error) {
    done = false;
  }
  napi_get_boolean(env, done, &result);
  return result;
}

// fill(handle, true) puts the window over its whole screen, the menu bar's place included; fill(handle, false) lets
// it be kept below the menu bar again, before it goes back to its own size. Electron keeps a window's top below the menu
// bar unless the window may be larger than the screen, so that is allowed only while it covers it.
static napi_value fill(napi_env env, napi_callback_info info) {
  size_t count = 2;
  napi_value args[2] = { NULL, NULL }, result;
  napi_get_cb_info(env, info, &count, args, NULL, NULL);
  bool cover = true;
  if (count > 1) napi_get_value_bool(env, args[1], &cover);
  NSWindow *window = count ? windowFrom(env, args[0]) : nil;
  NSScreen *screen = window.screen ?: NSScreen.mainScreen;
  SEL larger = NSSelectorFromString(@"setEnableLargerThanScreen:");
  if (window && [window respondsToSelector:larger]) [window setValue:@(cover) forKey:@"enableLargerThanScreen"];
  if (window && screen && cover) [window setFrame:screen.frame display:YES];
  napi_get_boolean(env, window && screen && (!cover || NSEqualRects(window.frame, screen.frame)), &result);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "geometry", NULL, geometry, NULL, NULL, NULL, napi_default, NULL },
    { "present", NULL, present, NULL, NULL, NULL, napi_default, NULL },
    { "fill", NULL, fill, NULL, NULL, NULL, napi_default, NULL },
  };
  napi_define_properties(env, exports, sizeof properties / sizeof *properties, properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
