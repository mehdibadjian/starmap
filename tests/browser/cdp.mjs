/**
 * Minimal Chrome DevTools Protocol driver — no dependencies, just Node 22's
 * global WebSocket and fetch. Deliberately not Playwright: the point of this
 * file is that the browser checks cost nothing to run and add nothing to
 * `npm install`, so they stay in the repo instead of rotting in a scratch dir.
 *
 * Only the handful of methods the smoke tests need are wired up.
 */
const BROWSER = `http://127.0.0.1:${process.env.CDP_PORT ?? 9222}`;

export async function connect(url) {
  const res = await fetch(`${BROWSER}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) throw new Error(`could not open a tab: HTTP ${res.status}`);
  const tab = await res.json();

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((ok, err) => {
    ws.onopen = ok;
    ws.onerror = () => err(new Error("CDP websocket connect failed"));
  });

  let nextId = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      const { ok, err } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) err(new Error(msg.error.message));
      else ok(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg.method, msg.params);
    }
  };

  /** Subscribe to CDP events. Returns an unsubscribe function. */
  const on = (method, fn) => {
    const listener = (m, params) => {
      if (m === method) fn(params);
    };
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const send = (method, params = {}, timeoutMs = 15_000) =>
    new Promise((ok, err) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        waiting.delete(id);
        err(new Error(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      waiting.set(id, {
        ok: (v) => {
          clearTimeout(timer);
          ok(v);
        },
        err: (e) => {
          clearTimeout(timer);
          err(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate threw");
    return r.result.value;
  };

  return { send, evaluate, on, tabId: tab.id, close: () => ws.close() };
}

export async function closeTab(tabId) {
  try {
    await fetch(`${BROWSER}/json/close/${tabId}`);
  } catch {
    /* the browser is already gone */
  }
}
