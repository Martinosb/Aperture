"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * The 3D hero (PRD §10 WindowObject).
 *
 * The object is the primary status display — text badges only confirm it. So
 * this is a real scene with individual slat meshes and a directional light
 * standing in for the sun, not a sprite: light genuinely passes between the
 * slats and lays striped shadows on the floor beneath.
 *
 * It runs on mid-range Android phones, so the render loop is on demand and only
 * spins while something is actually moving.
 */

export interface WindowObjectProps {
  /** 0–100, drives slat rotation. */
  position: number;
  /** 0–1200 lux, drives sun intensity. */
  lightLevel: number;
  thermalState: "heat-gain" | "comfortable";
  isMoving: boolean;
}

const SLAT_COUNT = 9;
const PANE_WIDTH = 2.05;
const PANE_HEIGHT = 1.72;

/** Fully open lays the slats back 74°, matching the design prototype. */
const MAX_SLAT_DEGREES = 74;

/** A physical motor eases; it never snaps (PRD §10). */
const SLAT_TRAVEL_MS = 900;
const REDUCED_MOTION_MS = 150;

const SKY_HEAT = ["#FFE9A8", "#FFC42E", "#F59A0B"] as const;
const SKY_COOL = ["#EDF2F5", "#A8BCC9", "#7C95A4"] as const;

function gradientTexture(stops: readonly [string, string, string]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext("2d");

  if (context !== null) {
    const gradient = context.createLinearGradient(0, 0, 24, 128);
    gradient.addColorStop(0, stops[0]);
    gradient.addColorStop(0.58, stops[1]);
    gradient.addColorStop(1, stops[2]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 128);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function Scene({ position, lightLevel, thermalState }: WindowObjectProps): React.JSX.Element {
  const { invalidate } = useThree();
  const slatsRef = useRef<THREE.Group>(null);
  const warmRef = useRef<THREE.Mesh>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);

  const heatTexture = useMemo(() => gradientTexture(SKY_HEAT), []);
  const coolTexture = useMemo(() => gradientTexture(SKY_COOL), []);

  useEffect(
    () => () => {
      heatTexture.dispose();
      coolTexture.dispose();
    },
    [heatTexture, coolTexture],
  );

  const targetAngle = (Math.min(100, Math.max(0, position)) / 100) * MAX_SLAT_DEGREES;
  const targetRadians = THREE.MathUtils.degToRad(targetAngle);
  const targetWarm = thermalState === "heat-gain" ? 1 : 0;
  const targetSun = 0.9 + Math.min(1, Math.max(0, lightLevel / 1200)) * 2.3;

  const current = useRef({ angle: targetRadians, warm: targetWarm, sun: targetSun });

  // Any prop change needs at least one frame to render, and the easing below
  // keeps requesting frames until it settles.
  useEffect(() => {
    invalidate();
  }, [invalidate, position, lightLevel, thermalState]);

  useFrame((_, delta) => {
    const slatMs = prefersReducedMotion() ? REDUCED_MOTION_MS : SLAT_TRAVEL_MS;
    const slatStep = Math.min(1, (delta * 1000) / (slatMs * 0.35));
    const fadeStep = Math.min(1, (delta * 1000) / (1200 * 0.35));

    const state = current.current;
    state.angle += (targetRadians - state.angle) * slatStep;
    state.warm += (targetWarm - state.warm) * fadeStep;
    state.sun += (targetSun - state.sun) * fadeStep;

    if (slatsRef.current !== null) {
      for (const slat of slatsRef.current.children) slat.rotation.x = state.angle;
    }
    if (warmRef.current !== null) {
      const material = warmRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = state.warm;
    }
    if (sunRef.current !== null) {
      sunRef.current.intensity = state.sun;
    }

    const settled =
      Math.abs(targetRadians - state.angle) < 0.0005 &&
      Math.abs(targetWarm - state.warm) < 0.004 &&
      Math.abs(targetSun - state.sun) < 0.004;

    if (!settled) invalidate();
  });

  const pitch = PANE_HEIGHT / SLAT_COUNT;
  const slats = Array.from({ length: SLAT_COUNT }, (_, i) => i);

  return (
    <group rotation={[THREE.MathUtils.degToRad(5), THREE.MathUtils.degToRad(-17), 0]}>
      <ambientLight intensity={1.55} />
      <directionalLight
        ref={sunRef}
        position={[-2.6, 3.4, 2.8]}
        intensity={targetSun}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-3}
        shadow-camera-right={3}
        shadow-camera-top={3}
        shadow-camera-bottom={-3}
        shadow-camera-near={0.1}
        shadow-camera-far={12}
      />

      {/* Sky behind the glass. Two stacked planes cross-fade over 1200ms so the
          thermal state is legible before a single word is read. */}
      <mesh position={[0, 0, -0.5]}>
        <planeGeometry args={[PANE_WIDTH + 0.08, PANE_HEIGHT + 0.08]} />
        <meshBasicMaterial map={coolTexture} toneMapped={false} />
      </mesh>
      <mesh ref={warmRef} position={[0, 0, -0.49]}>
        <planeGeometry args={[PANE_WIDTH + 0.08, PANE_HEIGHT + 0.08]} />
        <meshBasicMaterial map={heatTexture} transparent opacity={targetWarm} toneMapped={false} />
      </mesh>

      {/* Frame */}
      <mesh position={[0, 0, -0.62]} receiveShadow>
        <boxGeometry args={[PANE_WIDTH + 0.3, PANE_HEIGHT + 0.3, 0.12]} />
        <meshStandardMaterial color="#E3DED1" roughness={0.75} metalness={0.02} />
      </mesh>

      <group ref={slatsRef}>
        {slats.map((i) => (
          <mesh
            key={i}
            castShadow
            position={[0, PANE_HEIGHT / 2 - pitch / 2 - i * pitch, 0]}
            rotation={[targetRadians, 0, 0]}
          >
            <boxGeometry args={[PANE_WIDTH - 0.06, pitch * 0.94, 0.016]} />
            <meshStandardMaterial color="#FAF6EC" roughness={0.55} metalness={0.02} />
          </mesh>
        ))}
      </group>

      {/* Floor catching the striped light that gets past the slats. */}
      <mesh
        receiveShadow
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -PANE_HEIGHT / 2 - 0.16, 1.15]}
      >
        <planeGeometry args={[6, 3.4]} />
        <shadowMaterial opacity={0.28} />
      </mesh>
    </group>
  );
}

/** Static stand-in for WebGL-less contexts, matching the object's silhouette. */
export function WindowFallback({ position, thermalState }: WindowObjectProps): React.JSX.Element {
  const open = Math.min(100, Math.max(0, position)) / 100;
  const sky =
    thermalState === "heat-gain"
      ? "linear-gradient(168deg,#FFE9A8,#FFC42E 58%,#F59A0B)"
      : "linear-gradient(168deg,#EDF2F5,#A8BCC9 62%,#7C95A4)";

  return (
    <div
      className="absolute left-1/2 top-0 -translate-x-1/2"
      style={{ width: 246, height: 206, perspective: 1000 }}
      aria-hidden="true"
    >
      <div
        className="relative size-full"
        style={{ transform: "rotateY(-17deg) rotateX(5deg)", transformStyle: "preserve-3d" }}
      >
        <div
          className="absolute inset-0 rounded-[18px] p-[13px]"
          style={{
            background: "linear-gradient(155deg,#FDFBF6,#E3DED1 70%,#CFC8B9)",
            boxShadow:
              "0 30px 44px -20px rgba(20,17,13,.5), inset 0 0 0 1px rgba(255,255,255,.7)",
          }}
        >
          <div
            className="relative size-full overflow-hidden rounded-[9px]"
            style={{
              background: sky,
              transition: "background 1200ms linear",
              boxShadow: "inset 0 0 22px rgba(20,17,13,.18)",
              perspective: 520,
              transformStyle: "preserve-3d",
            }}
          >
            {Array.from({ length: SLAT_COUNT }, (_, i) => (
              <div
                key={i}
                className="absolute inset-x-0 rounded-[2px]"
                style={{
                  top: `${(i * 180) / SLAT_COUNT}px`,
                  height: `${180 / SLAT_COUNT + 1.2}px`,
                  background: "linear-gradient(180deg,#FEFCF8,#EDE8DC 55%,#C9C2B4)",
                  boxShadow: "0 2px 4px rgba(20,17,13,.22)",
                  transformOrigin: "50% 50%",
                  transform: `rotateX(${(open * MAX_SLAT_DEGREES).toFixed(1)}deg)`,
                  transition: "transform 900ms cubic-bezier(0.4, 0, 0.2, 1)",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return (
      canvas.getContext("webgl2") !== null ||
      canvas.getContext("webgl") !== null
    );
  } catch {
    return false;
  }
}

export function WindowObject(props: WindowObjectProps): React.JSX.Element {
  const [mode, setMode] = useState<"pending" | "webgl" | "fallback">("pending");

  useEffect(() => {
    // Reduced motion means the slat travel carries no information the user can
    // follow, so the static drawing is the honest choice (PRD §10).
    setMode(webglAvailable() && !prefersReducedMotion() ? "webgl" : "fallback");
  }, []);

  if (mode !== "webgl") return <WindowFallback {...props} />;

  return (
    <div className="absolute left-1/2 top-0 h-[224px] w-[300px] -translate-x-1/2">
      <Canvas
        shadows
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0.15, 4.15], fov: 34 }}
        style={{ background: "transparent" }}
      >
        <Scene {...props} />
      </Canvas>
    </div>
  );
}
