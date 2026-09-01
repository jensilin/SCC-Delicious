import { useCallback, useEffect, useRef, useState } from "react";

// The polling budget of the whole application, in one place. These are constants rather than
// configuration on purpose: an interval nobody will ever tune is not a setting, and putting the
// request rate in an .env file would make it something a deployment could get wrong.
//
// All four are three seconds so that automatic updating can be watched happening across two browser
// windows without waiting out an interval. The values this was tuned to, and the ones to return to
// once that checking is done, are 15s for both administrative screens — someone is watching a queue
// and acting on it — and 30s for a student's order list and 20s for their order detail, since a
// student's own orders move only when a shop moves them.
const ADMIN_ORDER_LIST_POLL_MS = 3_000;
const ADMIN_ORDER_DETAIL_POLL_MS = 3_000;
const STUDENT_ORDER_LIST_POLL_MS = 3_000;
const STUDENT_ORDER_DETAIL_POLL_MS = 3_000;

function documentIsHidden() {
  return document.visibilityState === "hidden";
}

/**
 * @template T
 * @typedef {object} PolledResource
 * @property {T} data The last value that was read successfully.
 * @property {"loading" | "ready" | "failed"} status Describes the first load only; a background
 *   refresh never moves it, which is what keeps a screen from blanking while it updates itself.
 * @property {import("./api-error").ApiError | null} error The failure of a foreground load.
 * @property {boolean} refreshing A read somebody asked for is in flight. The timer's own reads are
 *   not reported here, so an indicator bound to this cannot blink along with the polling interval.
 * @property {() => Promise<void>} reload Foreground: shows the loading state and reports failure.
 *   For a retry after the first load failed, where there is nothing on screen to preserve.
 * @property {() => Promise<void>} refresh Background: replaces the data silently or leaves it alone.
 *   Reported through `refreshing`, since it exists for a caller who is waiting on it.
 * @property {(value: T) => void} commit Adopts a value the caller already holds — a mutation
 *   response — and discards any read that is in flight.
 */

/**
 * Reads a resource once and then keeps it up to date in the background.
 *
 * The API has no push mechanism and no delta query: an order changes when the other party changes it,
 * and the only way this client finds out is by asking again. So it asks, on a timer, and the whole
 * design of this hook is about making that unobtrusive — the screen must not flicker, must not lose
 * what it is showing when a poll fails, and must not send a request nobody is waiting for.
 *
 * Four rules follow from that, and they are the reason this is a hook rather than four `setInterval`
 * calls:
 *
 *   - The next read is scheduled when the previous one finishes, never on a fixed interval. A slow
 *     response would otherwise let a second request start before the first returned.
 *   - Nothing is read while the tab is hidden. Browsers already throttle timers in background tabs and
 *     eventually freeze them, so a bare interval polls at a rate nobody chose; stopping outright makes
 *     the behaviour deterministic and costs the server nothing while no one is looking.
 *   - A caller performing a mutation pauses the timer, and `commit` invalidates a read that was
 *     already in flight when the mutation began. Without both, a poll issued a moment before the
 *     button was pressed can land afterwards and put the old value back on screen.
 *   - A failed background read changes nothing. The data on screen was true when it was read, which is
 *     better than an error panel where an order used to be.
 *
 * @template T
 * @param {() => Promise<T>} fetcher The read. Stable across renders — wrap it in useCallback, because
 *   its identity is what tells this hook the resource being read has changed.
 * @param {object} options
 * @param {number} options.intervalMs Delay between the end of one read and the start of the next.
 * @param {boolean} [options.paused] Suspends polling while true. Used for the duration of a mutation.
 * @param {T} [options.initialData] What `data` holds before the first read arrives.
 * @returns {PolledResource<T>}
 */
function usePolledResource(fetcher, { intervalMs, paused = false, initialData = null }) {
  const [data, setData] = useState(initialData);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hidden, setHidden] = useState(documentIsHidden);

  const mounted = useRef(true);
  const inFlight = useRef(/** @type {Promise<void> | null} */ (null));
  const wasHidden = useRef(false);

  // Every read is issued with a number, and only the newest number may write to state. This is what
  // discards a late answer: a read overtaken by a mutation, by a retry, or by a change of resource has
  // already been superseded by the time it arrives, and applying it would undo the newer value.
  const issue = useRef(0);

  // Reset on mount rather than only cleared on unmount, because StrictMode mounts a component twice in
  // development and the second mount would otherwise start with the flag the first one left false.
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    /**
     * @param {boolean} background
     * @param {boolean} announce Whether `refreshing` reports this read. A read the timer started is
     *   invisible by design — at a short interval an indicator that followed it would blink
     *   permanently, and the point of a background read is that nobody notices it. A read somebody
     *   asked for by pressing a button is announced, because they are waiting for it.
     */
    (background, announce) => {
      // Only a background read deduplicates. A foreground one is either the first read or a retry
      // after a failure, and answering it with a request already in flight would return the previous
      // resource to a caller that has just navigated to a different one.
      if (background && inFlight.current) {
        const joined = inFlight.current;

        if (!announce) {
          return joined;
        }

        // Still one request, not two: the caller waits on the read already running, and only the
        // indicator is added.
        setRefreshing(true);

        return joined.finally(() => {
          if (mounted.current) {
            setRefreshing(false);
          }
        });
      }

      if (announce) {
        setRefreshing(true);
      }

      if (!background) {
        setStatus("loading");
        setError(null);
      }

      const issued = (issue.current += 1);

      const pending = fetcher()
        .then((value) => {
          if (!mounted.current || issued !== issue.current) {
            return;
          }

          setData(value);
          setError(null);
          setStatus("ready");
        })
        .catch((caught) => {
          if (!mounted.current || issued !== issue.current) {
            return;
          }

          // A background failure is deliberately silent. The screen keeps the last value it read, and
          // the next tick will either recover or keep failing unseen; a transient network fault must
          // not replace an order with an error panel. A 401 is not handled here either — the API
          // client refreshes the token and replays the request, and ends the session itself when the
          // refresh cookie is gone, so a poll needs no session logic of its own.
          if (!background) {
            setError(caught);
            setStatus("failed");
          }
        })
        .finally(() => {
          // The announcement belongs to this call, so this call withdraws it however the read ended.
          if (mounted.current && announce) {
            setRefreshing(false);
          }

          // The slot belongs to whoever holds it: a read that has been superseded must not release a
          // newer request's claim on it.
          if (inFlight.current === pending) {
            inFlight.current = null;
          }
        });

      inFlight.current = pending;

      return pending;
    },
    [fetcher],
  );

  // The first read, and every later read caused by the resource itself changing — a different order id
  // gives a different fetcher, which is a new resource and deserves the loading state.
  useEffect(() => {
    run(false, false);
  }, [run]);

  useEffect(() => {
    function onVisibilityChange() {
      setHidden(documentIsHidden());
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Coming back to a tab that has been hidden means looking at data of unknown age, so it is read once
  // immediately rather than after another full interval. The flag is cleared only when that read is
  // actually issued, so a mutation in progress at that moment delays it rather than swallowing it.
  useEffect(() => {
    if (hidden) {
      wasHidden.current = true;

      return;
    }

    if (wasHidden.current && !paused) {
      wasHidden.current = false;
      run(true, false);
    }
  }, [hidden, paused, run]);

  // The timer. Each tick waits for its read to finish before scheduling the next, so two reads can
  // never overlap however slow the API is. Pausing, hiding the tab, changing resource or unmounting
  // all tear the loop down through this effect's cleanup, which is the only place a timer is cleared.
  useEffect(() => {
    if (paused || hidden) {
      return undefined;
    }

    let stopped = false;

    async function tick() {
      await run(true, false);

      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
      }
    }

    let timer = setTimeout(tick, intervalMs);

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run, intervalMs, paused, hidden]);

  const reload = useCallback(() => run(false, false), [run]);
  const refresh = useCallback(() => run(true, true), [run]);

  const commit = useCallback((value) => {
    // A mutation response is the resource as that change left it, read back inside the same
    // transaction server-side, so it is the most authoritative value this client will ever hold.
    // Moving the counter is what stops a read issued moments earlier from landing on top of it.
    issue.current += 1;

    setData(value);
    setError(null);
    setStatus("ready");
  }, []);

  return { data, status, error, refreshing, reload, refresh, commit };
}

export {
  ADMIN_ORDER_DETAIL_POLL_MS,
  ADMIN_ORDER_LIST_POLL_MS,
  STUDENT_ORDER_DETAIL_POLL_MS,
  STUDENT_ORDER_LIST_POLL_MS,
  usePolledResource,
};
