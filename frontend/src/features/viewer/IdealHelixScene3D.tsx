import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import {
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  type InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { HELIX_COLORS, type ColorMode, type IdealHelixModel, type IdealStaple, type Vec3 } from "./idealHelix";
import type { SceneHandle } from "./sceneTypes";

const TUBE_RADIUS = 0.13; // nm, backbone tube (display only)
const RUNG_RADIUS = 0.07;
const CAP_RADIUS = 0.2;
const SEGMENTS_PER_BASE = 3; // tube smoothness; 34° twist per base needs a few segments
const FOV_DEG = 45;

const v = (p: Vec3) => new Vector3(p[0], p[1], p[2]);

function tube(points: Vec3[]): TubeGeometry {
  // A one-base strand still needs two points for a curve.
  const pts = points.length > 1 ? points.map(v) : [v(points[0]!), v(points[0]!).add(new Vector3(0.01, 0, 0))];
  const curve = new CatmullRomCurve3(pts, false, "centripetal");
  return new TubeGeometry(curve, Math.max(2, pts.length * SEGMENTS_PER_BASE), TUBE_RADIUS, 8, false);
}

function material(color: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(color), roughness: 0.35, metalness: 0.05 });
}

/** Backbone tubes: one per helix scaffold, one per staple (separate meshes so staples can be picked). */
function Strands({
  model,
  onPick,
  highlight,
}: {
  model: IdealHelixModel;
  onPick?: (s: IdealStaple | null, pinned: boolean) => void;
  highlight?: string | null;
}) {
  const built = useMemo(() => {
    const mats = new Map<string, MeshStandardMaterial>();
    const mat = (c: string) => mats.get(c) ?? (mats.set(c, material(c)), mats.get(c)!);
    const scaffolds = model.helices.map((h) => ({ key: `h${h.index}`, geometry: tube(h.scaffold.points), material: mat(HELIX_COLORS.scaffold) }));
    const staples = model.staples.map((s) => ({ staple: s, geometry: tube(s.points), material: mat(s.color) }));
    const highlightMat = new MeshStandardMaterial({ color: new Color("#ffffff"), roughness: 0.3, emissive: new Color("#ffffff"), emissiveIntensity: 0.35 });
    return { scaffolds, staples, mats, highlightMat };
  }, [model]);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(
    () => () => {
      built.scaffolds.forEach((m) => m.geometry.dispose());
      built.staples.forEach((m) => m.geometry.dispose());
      built.mats.forEach((m) => m.dispose());
      built.highlightMat.dispose();
    },
    [built],
  );
  useEffect(() => invalidate(), [highlight, invalidate]);

  const pick = (s: IdealStaple, pinned: boolean) => (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    e.stopPropagation();
    onPick?.(s, pinned);
  };
  return (
    <>
      {built.scaffolds.map((m) => (
        <mesh key={m.key} geometry={m.geometry} material={m.material} />
      ))}
      {built.staples.map(({ staple, geometry, material: mat }) => (
        <mesh
          key={staple.id}
          geometry={geometry}
          material={highlight === staple.id ? built.highlightMat : mat}
          onPointerOver={pick(staple, false)}
          onPointerOut={() => onPick?.(null, false)}
          onClick={pick(staple, true)}
        />
      ))}
    </>
  );
}

/** Base-pair rungs as one InstancedMesh (thousands of base pairs stay a single draw call). */
function Rungs({ model, colorMode }: { model: IdealHelixModel; colorMode: ColorMode }) {
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geometry = useMemo(() => new CylinderGeometry(RUNG_RADIUS, RUNG_RADIUS, 1, 6), []);
  const mat = useMemo(() => new MeshStandardMaterial({ roughness: 0.35 }), []);
  useEffect(
    () => () => {
      geometry.dispose();
      mat.dispose();
    },
    [geometry, mat],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    model.rungs.forEach((r, i) => {
      const a = v(r.from);
      const b = v(r.to);
      const dir = b.clone().sub(a);
      const length = dir.length();
      q.setFromUnitVectors(up, dir.normalize());
      m.compose(a.add(b).multiplyScalar(0.5), q, new Vector3(1, length, 1));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [model]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new Color();
    model.rungs.forEach((r, i) => mesh.setColorAt(i, c.set(colorMode === "base" ? r.baseColor : r.strandColor)));
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [model, colorMode, invalidate]);

  if (model.rungs.length === 0) return null;
  return <instancedMesh ref={ref} args={[geometry, mat, model.rungs.length]} />;
}

/** Small sphere caps at both ends of every strand. */
function Caps({ model }: { model: IdealHelixModel }) {
  const ref = useRef<InstancedMesh>(null);
  const caps = useMemo(() => {
    const out: { p: Vec3; color: string }[] = [];
    for (const h of model.helices) {
      const pts = h.scaffold.points;
      out.push({ p: pts[0]!, color: HELIX_COLORS.scaffold }, { p: pts[pts.length - 1]!, color: HELIX_COLORS.scaffold });
    }
    for (const s of model.staples) out.push({ p: s.points[0]!, color: s.color }, { p: s.points[s.points.length - 1]!, color: s.color });
    return out;
  }, [model]);
  const geometry = useMemo(() => new SphereGeometry(CAP_RADIUS, 12, 12), []);
  const mat = useMemo(() => new MeshStandardMaterial({ roughness: 0.35 }), []);
  useEffect(
    () => () => {
      geometry.dispose();
      mat.dispose();
    },
    [geometry, mat],
  );
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const c = new Color();
    caps.forEach((cap, i) => {
      m.makeTranslation(cap.p[0], cap.p[1], cap.p[2]);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(cap.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [caps]);
  return <instancedMesh ref={ref} args={[geometry, mat, caps.length]} />;
}

/** Orbit controls with damping and optional auto-rotate, rendering only while something moves. */
const DampedControls = forwardRef<SceneHandle, { halfLength: number; radius: number; autoRotate: boolean }>(function DampedControls(
  { halfLength, radius, autoRotate },
  ref,
) {
  const { camera, gl, scene, invalidate, size } = useThree();
  const controls = useRef<OrbitControls | null>(null);
  // Fit the whole bundle: the helix axis (x) across the width, the lattice cross-section in the height.
  const aspect = size.width / Math.max(size.height, 1);
  const tanHalf = Math.tan((FOV_DEG * Math.PI) / 360);
  const distance = Math.max((halfLength * 1.12) / (tanHalf * aspect), (radius * 1.6) / tanHalf, 6) + radius;

  useEffect(() => {
    camera.position.set(0, distance * 0.28, distance);
    camera.lookAt(0, 0, 0);
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    const onChange = () => invalidate();
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

  useEffect(() => {
    if (!controls.current) return;
    controls.current.autoRotate = autoRotate;
    controls.current.autoRotateSpeed = 1.2;
    invalidate();
  }, [autoRotate, invalidate]);

  // With frameloop="demand", keep rendering while damping settles or auto-rotate runs.
  useFrame(() => {
    if (controls.current?.update()) invalidate();
  });

  useImperativeHandle(ref, () => ({
    reset: () => controls.current?.reset(),
    zoom: (factor: number) => {
      const c = controls.current;
      if (!c) return;
      const offset = new Vector3().subVectors(camera.position, c.target).divideScalar(factor);
      camera.position.copy(c.target).add(offset);
      c.update();
    },
    snapshot: () => {
      gl.render(scene, camera); // render now so the buffer is current when read
      return gl.domElement.toDataURL("image/png");
    },
  }));
  return null;
});

/** Idealized B-DNA model of a design (see idealHelix.ts). Remount (key) per design to release GPU resources. */
export const IdealHelixScene3D = forwardRef<
  SceneHandle,
  {
    model: IdealHelixModel;
    background: string;
    colorMode: ColorMode;
    autoRotate: boolean;
    highlight?: string | null;
    onPick?: (staple: IdealStaple | null, pinned: boolean) => void;
  }
>(function IdealHelixScene3D({ model, background, colorMode, autoRotate, highlight, onPick }, ref) {
  const far = Math.max(model.extent * 40, 200);
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: FOV_DEG, near: 0.1, far }}
      aria-label="3D idealized helix model"
      onPointerMissed={() => onPick?.(null, true)}
    >
      <color attach="background" args={[background]} />
      <hemisphereLight args={["#ffffff", "#445566", 0.75]} />
      <directionalLight position={[8, 12, 10]} intensity={1.3} />
      <directionalLight position={[-10, -4, -8]} intensity={0.45} />
      <Strands model={model} onPick={onPick} highlight={highlight} />
      <Rungs model={model} colorMode={colorMode} />
      <Caps model={model} />
      <DampedControls ref={ref} halfLength={model.halfLengthNm} radius={model.radiusNm} autoRotate={autoRotate} />
    </Canvas>
  );
});
