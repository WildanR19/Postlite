import assert from "node:assert/strict";
import { cmd, evaluate, reload, close } from "./tier1-cdp.mjs";

const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const settle = () => evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
const openAppearance = async () => {
  await click("#open-app-settings");
  await click("#app-settings-tabs [data-tab='pref-appearance']");
};
const selectAppearance = (value) => click(`#pref-appearance-${value}`);
const appearances = ["workbench", "classic", "focus", "terminal", "studio", "ledger"];
const styleSignature = () => evaluate(`(() => {
  const send = getComputedStyle(document.querySelector("#send"));
  const heading = getComputedStyle(document.querySelector(".request-head h2"));
  const tab = getComputedStyle(document.querySelector("#req-tabs .tab"));
  return [send.borderTopLeftRadius, send.height, heading.fontFamily, heading.fontSize, tab.paddingTop];
})()`);
const seed = () => evaluate(`(() => {
  const v = __verify;
  const tab = v.addTab(v.newRequest({ name: "Field notes", url: "http://127.0.0.1:8100/echo" }));
  tab.response = {
    status: 200, status_text: "OK", headers: [{key: "content-type", value: "application/json"}],
    body: '{"appearance":true}', elapsed_ms: 18, size_bytes: 19, results: [],
  };
  v.renderResponse();
})()`);

try {
  await reload();
  await cmd("Emulation.setDeviceMetricsOverride", { width: 1440, height: 820, deviceScaleFactor: 1, mobile: false });
  await evaluate(`(() => {
    const v = __verify;
    v.state.settings = v.normalizeSettings({general: {theme: "dark", accent: "ocean"}});
    v.applyAppSettings();
  })()`);
  await seed();
  await click("#res-tabs [data-tab='raw']");
  await openAppearance();
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-setting="general.appearance"]')].map(choice => choice.value)`), appearances);
  assert.equal(await evaluate("document.documentElement.dataset.appearance"), "workbench");
  await evaluate('document.querySelector("#pref-appearance-workbench").focus()');
  await cmd("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await cmd("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  assert.equal(await evaluate("document.documentElement.dataset.appearance"), "classic", "Arrow keys select the next appearance");
  await cmd("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  await settle();
  assert.deepEqual(await evaluate(`(() => {
    const selected = document.querySelector("#pref-appearance-classic");
    return { appearance: getComputedStyle(selected).appearance, dot: getComputedStyle(selected, "::after").content };
  })()`), { appearance: "auto", dot: "none" }, "High contrast uses the native checked indicator");
  await cmd("Emulation.setEmulatedMedia", { features: [] });

  const signatures = [];
  for (const appearance of appearances) {
    await selectAppearance(appearance);
    await settle();
    assert.deepEqual(await evaluate(`({
      style: document.documentElement.dataset.appearance,
      theme: document.documentElement.dataset.theme,
      accent: document.documentElement.dataset.accent,
      raw: document.querySelector("#raw.is-active")?.textContent,
    })`), { style: appearance, theme: "dark", accent: "ocean", raw: '{"appearance":true}' });
    signatures.push(await styleSignature());
    if (appearance === "classic") {
      await evaluate(`Promise.allSettled(document.querySelector(".main").getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => true)`);
      assert.deepEqual(await evaluate(`(() => {
        const root = getComputedStyle(document.documentElement);
        const main = getComputedStyle(document.querySelector(".main"));
        return {
          background: root.getPropertyValue("--bg-0").trim(),
          topbar: getComputedStyle(document.querySelector(".topbar")).height,
          command: root.getPropertyValue("--command-height").trim(),
          divider: main.getPropertyValue("--res-divider-size").trim(),
          requestLayout: getComputedStyle(document.querySelector("#req-pane")).display,
          sendBackground: getComputedStyle(document.querySelector("#send")).backgroundColor,
          pulse: getComputedStyle(document.querySelector(".res-pulse")).display,
        };
      })()`), {
        background: "#0b0d10",
        topbar: "44px",
        command: "36px",
        divider: "6px",
        requestLayout: "grid",
        sendBackground: "rgba(0, 0, 0, 0)",
        pulse: "block",
      }, "Classic restores the compact surfaces and controls");
      await evaluate(`(() => {
        __verify.state.settings.general.theme = "light";
        __verify.applyAppSettings();
      })()`);
      assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--bg-0").trim()`), "#f4f6f8");
      await evaluate(`(() => {
        const settings = __verify.state.settings.general;
        settings.theme = "dark";
        settings.accent = "ember";
        __verify.applyAppSettings();
      })()`);
      assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()`), "#ff6b35");
      await evaluate(`(() => {
        __verify.state.settings.general.accent = "ocean";
        __verify.applyAppSettings();
      })()`);
      await click("#res-tabs [data-tab='raw']");
    }
    if (appearance === "focus") {
      await evaluate(`Promise.allSettled(document.querySelector(".main").getAnimations({ subtree: true }).map(animation => animation.finished)).then(() => true)`);
      assert.deepEqual(await evaluate(`(() => {
        const root = getComputedStyle(document.documentElement);
        const main = getComputedStyle(document.querySelector(".main"));
        return {
          background: root.getPropertyValue("--bg-0").trim(),
          topbar: getComputedStyle(document.querySelector(".topbar")).height,
          command: root.getPropertyValue("--command-height").trim(),
          divider: main.getPropertyValue("--res-divider-size").trim(),
          requestLayout: getComputedStyle(document.querySelector("#req-pane")).display,
          sendBackground: getComputedStyle(document.querySelector("#send")).backgroundColor,
          pulse: getComputedStyle(document.querySelector(".res-pulse")).display,
        };
      })()`), {
        background: "#12161b",
        topbar: "52px",
        command: "40px",
        divider: "10px",
        requestLayout: "flex",
        sendBackground: "rgb(32, 38, 46)",
        pulse: "none",
      }, "Focus keeps surfaces quiet and accents restrained");
      await evaluate(`(() => {
        __verify.state.settings.general.theme = "light";
        __verify.applyAppSettings();
      })()`);
      assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue("--bg-0").trim()`), "#f2f5f8");
      await evaluate(`(() => {
        const settings = __verify.state.settings.general;
        settings.theme = "dark";
        settings.accent = "ocean";
        __verify.applyAppSettings();
      })()`);
      await click("#res-tabs [data-tab='raw']");
    }
  }
  assert.equal(new Set(signatures.map(signature => JSON.stringify(signature))).size, 6, "Styles differ in shape, type, or spacing");
  await selectAppearance("focus");
  await evaluate("__verify.flushWorkspace().then(() => true)");
  await reload();
  assert.equal(await evaluate("document.documentElement.dataset.appearance"), "focus", "The Focus style survives a workspace reload");
  await openAppearance();
  assert.equal(await evaluate('document.querySelector("#pref-appearance-focus").checked'), true);

  await evaluate(`(() => {
    const input = document.querySelector("#pref-search");
    input.value = "workbench style";
    input.dispatchEvent(new Event("input", {bubbles: true}));
  })()`);
  assert.equal(await evaluate('document.querySelector("#pref-appearance-workbench").closest(".preferences-row").hidden'), false);
  assert.equal(await evaluate(`__verify.normalizeSettings({general:{appearance:"unknown"}}).general.appearance`), "workbench");
  await evaluate(`__verify.importSettings({kind:"postlite.settings",version:1,settings:{general:{appearance:"studio", theme:"light", accent:"mint"}}})`);
  assert.deepEqual(await evaluate(`[
    document.documentElement.dataset.appearance, document.documentElement.dataset.theme,
    document.documentElement.dataset.accent, document.querySelector("#pref-appearance-studio").checked,
  ]`), ["studio", "light", "mint", true]);
  console.log("PASS appearance selection, distinct geometry, response preservation, search, reload, and settings import");
} finally {
  await cmd("Emulation.setEmulatedMedia", { features: [] });
  await cmd("Emulation.clearDeviceMetricsOverride");
  close();
}
