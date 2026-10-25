/**
 * The app's fixed names, the same in every release (desktop-design, Names and folders): the
 * AppUserModelID (electron-builder's appId), the ToastActivatorCLSID carried into the packaged
 * package.json, and the product name. electron-builder.json holds the same values; a test keeps them equal.
 */
// @spec DESK-DIST-PKG-001, DESK-DIST-PKG-002, DESK-DIST-PKG-006

export const APP_ID = "io.github.sharpwave.msfscareermap";
export const TOAST_CLSID = "{69576F59-9E6C-4DE8-8C3F-10C5489AA31F}";
export const PRODUCT_NAME = "MSFS Career Map";
