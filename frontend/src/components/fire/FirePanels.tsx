import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { EmberLayer } from "./emberLayer";
import { chooseFireBackend, type FireBackend } from "./fireBackend";

interface FirePanelProps {
  backend: FireBackend;
}

/** Live decorative-layer state for console diagnosis — call `fireDebug()` in devtools. */
export interface FireDebugSnapshot {
  requested: FireBackend;
  active: FireBackend;
  frames: number;
  cssWidth: number;
  cssHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  adapter: string | null;
}

let debugReader: (() => FireDebugSnapshot | null) | null = null;

export function getFireDebug(): FireDebugSnapshot | null {
  return debugReader?.() ?? null;
}

function FirePanel({ backend }: FirePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Which backend actually paints the background — WebGPU may fail at init and
  // roll back to the ember canvas. Exposed as a data attribute for tests.
  const [active, setActive] = useState<FireBackend>(backend === "webgpu" ? "ember" : backend);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || backend === "static") {
      return;
    }
    let disposed = false;
    let effect: { stop(): void; debug: { frames: number } } | null = null;
    let resolved: FireBackend = backend === "webgpu" ? "ember" : backend;
    let adapter: string | null = null;

    debugReader = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        requested: backend,
        active: resolved,
        frames: effect?.debug.frames ?? 0,
        cssWidth: Math.round(rect.width),
        cssHeight: Math.round(rect.height),
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        dpr: globalThis.devicePixelRatio ?? 1,
        adapter,
      };
    };

    const report = (): void => {
      console.info("[fire]", JSON.stringify(debugReader?.() ?? null));
    };

    const startEmber = (): void => {
      if (!disposed) {
        const layer = new EmberLayer(canvas);
        layer.start();
        effect = layer;
        resolved = "ember";
        setActive("ember");
        report();
      }
    };

    if (backend === "webgpu") {
      void import("./wgpuFire")
        .then(async ({ createWgpuFire: create }) => {
          const handle = await create(canvas);
          if (disposed) {
            handle?.stop();
            return;
          }
          if (handle !== null) {
            effect = handle;
            adapter = handle.debug.adapter;
            resolved = "webgpu";
            setActive("webgpu");
            report();
          } else {
            startEmber();
          }
        })
        .catch(() => startEmber());
    } else {
      startEmber();
    }

    return () => {
      disposed = true;
      effect?.stop();
    };
  }, [backend]);

  return (
    <aside
      className={`fire-panel${backend === "static" ? " fire-panel--static" : ""}`}
      data-fire-backend={active}
      aria-hidden="true"
    >
      {backend === "static" ? null : <canvas ref={canvasRef} className="fire-panel-canvas" />}
    </aside>
  );
}

/**
 * Decorative full-background layer mounted behind the signed-in layout: a
 * WebGPU spark-particle shader when the browser supports it (except Windows,
 * which stays on the ember fallback), a 2D-canvas ember fallback otherwise,
 * and a static gradient under reduced motion.
 */
export function FirePanels() {
  const reduced = usePrefersReducedMotion();
  const backend = chooseFireBackend(
    reduced,
    typeof navigator !== "undefined" && navigator.gpu !== undefined,
  );

  useEffect(() => {
    const scope = window as unknown as { fireDebug?: typeof getFireDebug };
    scope.fireDebug = getFireDebug;
    return () => {
      if (scope.fireDebug === getFireDebug) {
        delete scope.fireDebug;
      }
    };
  }, []);

  return (
    <div className="fire-panels" aria-hidden="true">
      <FirePanel backend={backend} />
    </div>
  );
}
