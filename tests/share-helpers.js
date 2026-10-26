// Shared fakes for the file-sharing tests: a phone whose browser may (or may not) share files, and a recorder for
// the programmatic <a download> clicks.
export const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
export const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
export const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
export const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export const NAME = (n) => `photo_mariage_Thomas-Aziliz_311026_${String(n).padStart(2, "0")}.jpg`;
export const counter = (page) => page.evaluate(() => Number(sessionStorage.getItem("wk_downloads") || 0));
export const downloads = (page) => page.evaluate(() => window.__downloads);

export async function recordDownloads(page) {
  await page.addInitScript(() => {
    window.__downloads = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.hasAttribute("download")) window.__downloads.push(this.getAttribute("download"));
    };
  });
}
// options: outcome "ok" | "abort" | "abort-once" | "fail"; canShare true | false | "missing"; coarse (touch) true | false;
// ua: a user agent string; errorName: name of the error when the share fails.
export async function phone(page, { outcome = "ok", canShare = true, coarse = true, ua = IPHONE, errorName = "NotAllowedError", touchPoints } = {}) {
  await page.addInitScript(
    ({ outcome, canShare, coarse, ua, errorName, touchPoints }) => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (query) =>
        /pointer:\s*coarse/.test(query) ? { matches: coarse, media: query, addEventListener() {}, removeEventListener() {} } : real(query);
      if (ua) Object.defineProperty(navigator, "userAgent", { get: () => ua });
      if (touchPoints !== undefined) Object.defineProperty(navigator, "maxTouchPoints", { get: () => touchPoints });
      window.__shared = [];
      window.__fetchesAfterClick = 0;
      window.__sharedAtFetchCount = [];
      const realFetch = window.fetch.bind(window);
      window.__fetches = 0;
      window.fetch = (...args) => (window.__fetches++, realFetch(...args));
      if (canShare === "missing") {
        Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
        Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true });
        return;
      }
      navigator.canShare = () => canShare;
      navigator.share = (data) => {
        window.__shared.push(data.files.map((f) => `${f.name}|${f.type}|${f.size > 0}`));
        window.__sharedAtFetchCount.push(window.__fetches);
        if (outcome === "abort" || (outcome === "abort-once" && window.__shared.length === 1))
          return Promise.reject(new DOMException("cancelled", "AbortError"));
        if (outcome === "fail") return Promise.reject(new DOMException("denied", errorName));
        return Promise.resolve();
      };
    },
    { outcome, canShare, coarse, ua, errorName, touchPoints },
  );
}
