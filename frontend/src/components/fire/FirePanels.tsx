import { useEffect, useRef, useState } from "react";

import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { EmberLayer } from "./emberLayer";
import { chooseFireBackend, type FireBackend } from "./fireBackend";

interface FirePanelProps {
  backend: FireBackend;
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
    let effect: { stop(): void } | null = null;

    const startEmber = (): void => {
      if (!disposed) {
        const layer = new EmberLayer(canvas);
        layer.start();
        effect = layer;
        setActive("ember");
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
            setActive("webgpu");
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
 * WebGPU spark-particle shader when the browser supports it, a 2D-canvas ember
 * fallback otherwise, and a static gradient under reduced motion.
 */
export function FirePanels() {
  const reduced = usePrefersReducedMotion();
  const backend = chooseFireBackend(
    reduced,
    typeof navigator !== "undefined" && navigator.gpu !== undefined,
  );

  return (
    <div className="fire-panels" aria-hidden="true">
      <FirePanel backend={backend} />
    </div>
  );
}
