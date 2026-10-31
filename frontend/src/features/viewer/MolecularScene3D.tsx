import { Canvas, useThree } from "@react-three/fiber";
import { forwardRef, useLayoutEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, Color, type InstancedMesh, Matrix4 } from "three";

import type { MolecularGeometry } from "../../api/client";
import { Controls } from "./Scene3D";
import { MOLECULAR_COLORS, type SceneHandle } from "./sceneTypes";

type Strand = MolecularGeometry["strands"][number];

export function strandColor(s: Strand): string {
  if (s.role === "staple" && s.variant && !s.variant.is_original) {
    return s.variant.length_compatible ? MOLECULAR_COLORS.variantSelected : MOLECULAR_COLORS.variantIncompatible;
  }
  return MOLECULAR_COLORS[s.role];
}

const NUCLEOTIDE_RADIUS = 0.3; // oxDNA units, display size only

function Nucleotides({ geometry }: { geometry: MolecularGeometry }) {
  const ref = useRef<InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new Matrix4();
    const c = new Color();
    for (const s of geometry.strands) {
      c.set(strandColor(s));
      for (let k = 0; k < s.length; k++) {
        const i = s.offset + k;
        const p = geometry.positions;
        m.makeTranslation(p[3 * i]!, p[3 * i + 1]!, p[3 * i + 2]!);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [geometry, invalidate]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, geometry.nucleotides]}>
      <sphereGeometry args={[NUCLEOTIDE_RADIUS, 8, 6]} />
      <meshStandardMaterial />
    </instancedMesh>
  );
}

/** Backbone: a segment between consecutive nucleotides of each strand (they are bonded in the topology). */
function Backbone({ geometry }: { geometry: MolecularGeometry }) {
  const buffer = useMemo(() => {
    const pts: number[] = [];
    const cols: number[] = [];
    const c = new Color();
    const p = geometry.positions;
    for (const s of geometry.strands) {
      c.set(strandColor(s));
      const pairs: [number, number][] = [];
      for (let k = 0; k + 1 < s.length; k++) pairs.push([s.offset + k, s.offset + k + 1]);
      if (s.circular && s.length > 2) pairs.push([s.offset + s.length - 1, s.offset]);
      for (const [a, b] of pairs) {
        pts.push(p[3 * a]!, p[3 * a + 1]!, p[3 * a + 2]!, p[3 * b]!, p[3 * b + 1]!, p[3 * b + 2]!);
        cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(pts), 3));
    g.setAttribute("color", new BufferAttribute(new Float32Array(cols), 3));
    return g;
  }, [geometry]);
  // Passed as a prop (not declared in JSX), so dispose it explicitly when replaced or unmounted.
  useLayoutEffect(() => () => buffer.dispose(), [buffer]);
  return (
    <lineSegments geometry={buffer}>
      <lineBasicMaterial vertexColors />
    </lineSegments>
  );
}

/** Renders oxDNA coordinates as stored. Remount (key) per structure so all GPU resources are released. */
export const MolecularScene3D = forwardRef<SceneHandle, { geometry: MolecularGeometry; background?: string }>(function MolecularScene3D(
  { geometry, background = "#f8fafc" },
  ref,
) {
  const radius = useMemo(() => {
    let r = 0;
    const p = geometry.positions;
    for (let i = 0; i < p.length; i += 3) r = Math.max(r, Math.hypot(p[i]!, p[i + 1]!, p[i + 2]!));
    return r;
  }, [geometry]);
  const distance = Math.max(radius * 2.6, 10);
  return (
    <Canvas frameloop="demand" dpr={[1, 2]} camera={{ fov: 50, near: 0.1, far: distance * 20 }} aria-label="3D molecular structure">
      <color attach="background" args={[background]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 10]} intensity={1.2} />
      <Nucleotides geometry={geometry} />
      <Backbone geometry={geometry} />
      <Controls ref={ref} distance={distance} />
    </Canvas>
  );
});
