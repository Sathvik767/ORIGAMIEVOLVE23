import { Canvas, useThree } from "@react-three/fiber";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import { Color, type InstancedMesh, Matrix4, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { BarVariant, IndexSchematic } from "./geometry";
import { BAR_COLORS, type SceneHandle } from "./sceneTypes";

const UNIT = 0.1; // scene units per nucleotide index (display scale only)
const LANE_GAP = 1.2; // display spacing between helix lanes (not a physical distance)
const BAR_THICKNESS = 0.45;

function useLayout(geometry: IndexSchematic) {
  return useMemo(() => {
    const width = (geometry.maxIndex - geometry.minIndex + 1) * UNIT;
    const laneY = new Map(geometry.lanes.map((h, i) => [h, (i - (geometry.lanes.length - 1) / 2) * -LANE_GAP]));
    const x0 = -width / 2;
    const xOf = (index: number) => x0 + (index - geometry.minIndex) * UNIT;
    return { width, laneY, xOf, height: geometry.lanes.length * LANE_GAP };
  }, [geometry]);
}

function Bars({ geometry, variant }: { geometry: IndexSchematic; variant: BarVariant }) {
  const ref = useRef<InstancedMesh>(null);
  const { laneY, xOf } = useLayout(geometry);
  const bars = useMemo(() => geometry.bars.filter((b) => b.variant === variant), [geometry, variant]);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    bars.forEach((b, i) => {
      const length = (b.end - b.start + 1) * UNIT;
      m.makeScale(length, BAR_THICKNESS, BAR_THICKNESS);
      m.setPosition(xOf(b.start) + length / 2, laneY.get(b.helix) ?? 0, 0);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [bars, laneY, xOf, invalidate]);

  if (bars.length === 0) return null;
  // Geometry and material are declared in JSX, so React Three Fiber disposes them on unmount.
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, bars.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color={new Color(BAR_COLORS[variant])} />
    </instancedMesh>
  );
}

function LaneGuides({ geometry }: { geometry: IndexSchematic }) {
  const { width, laneY } = useLayout(geometry);
  return (
    <>
      {geometry.lanes.map((h) => (
        <mesh key={h} position={[0, laneY.get(h) ?? 0, -BAR_THICKNESS]}>
          <boxGeometry args={[width, 0.04, 0.04]} />
          <meshBasicMaterial color="#cbd5e1" />
        </mesh>
      ))}
    </>
  );
}

export const Controls = forwardRef<SceneHandle, { distance: number }>(function Controls({ distance }, ref) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<OrbitControls | null>(null);

  useEffect(() => {
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    const c = new OrbitControls(camera, gl.domElement); // rotate: left drag, zoom: wheel, pan: right drag
    c.enableDamping = false;
    const onChange = () => invalidate(); // re-render only when the camera moves (frameloop="demand")
    c.addEventListener("change", onChange);
    c.saveState();
    controls.current = c;
    invalidate();
    return () => {
      c.removeEventListener("change", onChange);
      c.dispose();
      controls.current = null;
    };
  }, [camera, gl, invalidate, distance]);

  useImperativeHandle(ref, () => ({
    reset: () => controls.current?.reset(),
    zoom: (factor: number) => {
      const c = controls.current;
      if (!c) return;
      const offset = new Vector3().subVectors(camera.position, c.target).divideScalar(factor);
      camera.position.copy(c.target).add(offset);
      c.update();
    },
  }));
  return null;
});

/** Renders an index-space schematic. Remount (key) per design so all GPU resources are released. */
export const Scene3D = forwardRef<SceneHandle, { geometry: IndexSchematic }>(function Scene3D({ geometry }, ref) {
  const { width, height } = useLayout(geometry);
  const distance = Math.max(width, height * 1.6, 6) * 1.1;
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: 50, near: 0.1, far: distance * 20 }}
      aria-label="3D index-space schematic"
    >
      <color attach="background" args={["#f8fafc"]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[5, 8, 10]} intensity={1.2} />
      <LaneGuides geometry={geometry} />
      <Bars geometry={geometry} variant="original" />
      <Bars geometry={geometry} variant="selected-variant" />
      <Bars geometry={geometry} variant="not-optimized" />
      <Controls ref={ref} distance={distance} />
    </Canvas>
  );
});
