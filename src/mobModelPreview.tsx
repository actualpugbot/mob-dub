import { useEffect, useRef, useState } from "react";
import type { MobDefinition, MobModelCube, MobModelDefinition, MobModelPart } from "./types";

type PreviewSize = "card" | "list";
type Matrix4 = [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
type Vec2 = { u: number; v: number };
type Vec3 = { x: number; y: number; z: number };

interface Face {
  normal: Vec3;
  vertices: Vec3[];
  uvs: Vec2[];
}

const PREVIEW_DIMENSIONS: Record<PreviewSize, number> = {
  card: 72,
  list: 44,
};

const PREVIEW_RENDER_SCALE: Record<PreviewSize, number> = {
  card: 1.8,
  list: 2.2,
};

const PREVIEW_PADDING: Record<PreviewSize, number> = {
  card: 12,
  list: 8,
};

const VIEW_YAW = -Math.PI / 4.4;
const VIEW_PITCH = -Math.PI / 6.8;
const FACE_LIGHT = normalizeVector({ x: -0.4, y: 0.8, z: -1 });
const IDENTITY_MATRIX: Matrix4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const textureCache = new Map<string, Promise<HTMLImageElement>>();
const previewCache = new Map<string, HTMLCanvasElement>();

export function MobModelPreview({
  mob,
  model,
  size,
}: {
  mob: MobDefinition;
  model?: MobModelDefinition;
  size: PreviewSize;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    setRenderFailed(false);
  }, [mob.imagePath, mob.localId, model, size]);

  useEffect(() => {
    let active = true;

    if (!model || !mob.imagePath || renderFailed) {
      return () => {
        active = false;
      };
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return () => {
        active = false;
      };
    }

    const cacheKey = buildPreviewCacheKey(mob.localId, size);
    renderPreview(cacheKey, canvas, mob.imagePath, model, size)
      .catch(() => {
        if (active) {
          setRenderFailed(true);
        }
      });

    return () => {
      active = false;
    };
  }, [mob.imagePath, mob.localId, model, renderFailed, size]);

  if (!model || !mob.imagePath || renderFailed) {
    return <FallbackPreview mob={mob} size={size} />;
  }

  return <canvas aria-hidden="true" className={`mob-preview mob-preview--${size}`} ref={canvasRef} />;
}

function FallbackPreview({ mob, size }: { mob: MobDefinition; size: PreviewSize }) {
  if (mob.imagePath) {
    return <img alt="" className={`mob-preview mob-preview--${size} mob-preview-image`} decoding="async" loading="lazy" src={mob.imagePath} />;
  }

  return (
    <span aria-hidden="true" className={`mob-preview mob-preview--${size} mob-preview-fallback`}>
      {mob.displayName.charAt(0)}
    </span>
  );
}

async function renderPreview(
  cacheKey: string,
  targetCanvas: HTMLCanvasElement,
  textureSource: string,
  model: MobModelDefinition,
  size: PreviewSize,
) {
  const cached = previewCache.get(cacheKey);
  if (cached) {
    copyCanvas(targetCanvas, cached);
    return;
  }

  const renderedCanvas = await buildRenderedPreview(textureSource, model, size);
  previewCache.set(cacheKey, renderedCanvas);
  copyCanvas(targetCanvas, renderedCanvas);
}

async function buildRenderedPreview(textureSource: string, model: MobModelDefinition, size: PreviewSize) {
  const image = await loadTexture(textureSource);
  const canvas = document.createElement("canvas");
  const baseSize = PREVIEW_DIMENSIONS[size];
  const deviceScale = Math.max(window.devicePixelRatio || 1, PREVIEW_RENDER_SCALE[size]);
  const canvasSize = Math.ceil(baseSize * deviceScale);

  canvas.width = canvasSize;
  canvas.height = canvasSize;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Could not create the preview canvas.");
  }

  context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
  context.clearRect(0, 0, baseSize, baseSize);
  context.imageSmoothingEnabled = false;

  const faces = collectFaces(model.root, IDENTITY_MATRIX, model.textureWidth, model.textureHeight);
  const projectedFaces = faces
    .map((face) => projectFace(face))
    .filter((face) => face.normal.z < -0.04)
    .sort((a, b) => a.depth - b.depth);

  if (projectedFaces.length === 0) {
    throw new Error("No renderable faces were produced for this mob.");
  }

  const bounds = measureBounds(projectedFaces);
  const padding = PREVIEW_PADDING[size];
  const scale = Math.min((baseSize - padding * 2) / Math.max(bounds.width, 0.001), (baseSize - padding * 2) / Math.max(bounds.height, 0.001));
  const offsetX = baseSize / 2 - (bounds.minX + bounds.maxX) * 0.5 * scale;
  const offsetY = baseSize / 2 - (bounds.minY + bounds.maxY) * 0.5 * scale + baseSize * 0.04;

  drawShadow(context, baseSize, bounds, scale, offsetX, offsetY);

  for (const face of projectedFaces) {
    const screenVertices = face.vertices.map((vertex) => ({
      x: vertex.x * scale + offsetX,
      y: vertex.y * scale + offsetY,
    }));

    drawTexturedQuad(context, image, face.uvs, screenVertices);
    shadeFace(context, face.normal, screenVertices);
  }

  return canvas;
}

function collectFaces(part: MobModelPart, parentMatrix: Matrix4, textureWidth: number, textureHeight: number) {
  const faces: Face[] = [];
  const partMatrix = multiplyMatrices(parentMatrix, createPartMatrix(part));

  for (const cube of part.cubes) {
    faces.push(...buildCubeFaces(cube, partMatrix, textureWidth, textureHeight));
  }

  for (const child of Object.values(part.children)) {
    faces.push(...collectFaces(child, partMatrix, textureWidth, textureHeight));
  }

  return faces;
}

function buildCubeFaces(cube: MobModelCube, matrix: Matrix4, textureWidth: number, textureHeight: number) {
  const minX = (cube.x - cube.growX) / 16;
  const minY = (cube.y - cube.growY) / 16;
  const minZ = (cube.z - cube.growZ) / 16;
  const maxX = (cube.x + cube.w + cube.growX) / 16;
  const maxY = (cube.y + cube.h + cube.growY) / 16;
  const maxZ = (cube.z + cube.d + cube.growZ) / 16;
  const x0 = cube.mirror ? maxX : minX;
  const x1 = cube.mirror ? minX : maxX;

  const t0 = { x: x0, y: minY, z: minZ };
  const t1 = { x: x1, y: minY, z: minZ };
  const t2 = { x: x1, y: maxY, z: minZ };
  const t3 = { x: x0, y: maxY, z: minZ };
  const l0 = { x: x0, y: minY, z: maxZ };
  const l1 = { x: x1, y: minY, z: maxZ };
  const l2 = { x: x1, y: maxY, z: maxZ };
  const l3 = { x: x0, y: maxY, z: maxZ };

  const u0 = cube.u;
  const u1 = cube.u + cube.d;
  const u2 = cube.u + cube.d + cube.w;
  const u22 = cube.u + cube.d + cube.w + cube.w;
  const u3 = cube.u + cube.d + cube.w + cube.d;
  const u4 = cube.u + cube.d + cube.w + cube.d + cube.w;
  const v0 = cube.v;
  const v1 = cube.v + cube.d;
  const v2 = cube.v + cube.d + cube.h;

  return [
    createFace(
      [l1, l0, t0, t1],
      [{ u: u2 / textureWidth, v: v0 / textureHeight }, { u: u1 / textureWidth, v: v0 / textureHeight }, { u: u1 / textureWidth, v: v1 / textureHeight }, { u: u2 / textureWidth, v: v1 / textureHeight }],
      { x: 0, y: -1, z: 0 },
      cube.mirror,
      matrix,
    ),
    createFace(
      [t2, t3, l3, l2],
      [{ u: u22 / textureWidth, v: v1 / textureHeight }, { u: u2 / textureWidth, v: v1 / textureHeight }, { u: u2 / textureWidth, v: v0 / textureHeight }, { u: u22 / textureWidth, v: v0 / textureHeight }],
      { x: 0, y: 1, z: 0 },
      cube.mirror,
      matrix,
    ),
    createFace(
      [t0, l0, l3, t3],
      [{ u: u1 / textureWidth, v: v1 / textureHeight }, { u: u0 / textureWidth, v: v1 / textureHeight }, { u: u0 / textureWidth, v: v2 / textureHeight }, { u: u1 / textureWidth, v: v2 / textureHeight }],
      { x: -1, y: 0, z: 0 },
      cube.mirror,
      matrix,
    ),
    createFace(
      [t1, t0, t3, t2],
      [{ u: u2 / textureWidth, v: v1 / textureHeight }, { u: u1 / textureWidth, v: v1 / textureHeight }, { u: u1 / textureWidth, v: v2 / textureHeight }, { u: u2 / textureWidth, v: v2 / textureHeight }],
      { x: 0, y: 0, z: -1 },
      cube.mirror,
      matrix,
    ),
    createFace(
      [l1, t1, t2, l2],
      [{ u: u3 / textureWidth, v: v1 / textureHeight }, { u: u2 / textureWidth, v: v1 / textureHeight }, { u: u2 / textureWidth, v: v2 / textureHeight }, { u: u3 / textureWidth, v: v2 / textureHeight }],
      { x: 1, y: 0, z: 0 },
      cube.mirror,
      matrix,
    ),
    createFace(
      [l0, l1, l2, l3],
      [{ u: u4 / textureWidth, v: v1 / textureHeight }, { u: u3 / textureWidth, v: v1 / textureHeight }, { u: u3 / textureWidth, v: v2 / textureHeight }, { u: u4 / textureWidth, v: v2 / textureHeight }],
      { x: 0, y: 0, z: 1 },
      cube.mirror,
      matrix,
    ),
  ];
}

function createFace(vertices: Vec3[], uvs: Vec2[], normal: Vec3, mirror: boolean, matrix: Matrix4): Face {
  const faceVertices = vertices.map((vertex, index) => ({
    position: transformPoint(matrix, vertex),
    uv: uvs[index],
  }));

  if (mirror) {
    faceVertices.reverse();
  }

  return {
    normal: normalizeVector(transformVector(matrix, normal)),
    vertices: faceVertices.map((entry) => entry.position),
    uvs: faceVertices.map((entry) => entry.uv),
  };
}

function projectFace(face: Face) {
  const vertices = face.vertices.map((vertex) => rotateView(vertex));
  const normal = normalizeVector(rotateView(face.normal));
  const depth = vertices.reduce((sum, vertex) => sum + vertex.z, 0) / vertices.length;

  return {
    depth,
    normal,
    uvs: face.uvs,
    vertices,
  };
}

function rotateView(vector: Vec3) {
  const yawCos = Math.cos(VIEW_YAW);
  const yawSin = Math.sin(VIEW_YAW);
  const pitchCos = Math.cos(VIEW_PITCH);
  const pitchSin = Math.sin(VIEW_PITCH);

  const yawed = {
    x: vector.x * yawCos - vector.z * yawSin,
    y: vector.y,
    z: vector.x * yawSin + vector.z * yawCos,
  };

  return {
    x: yawed.x,
    y: yawed.y * pitchCos - yawed.z * pitchSin,
    z: yawed.y * pitchSin + yawed.z * pitchCos,
  };
}

function measureBounds(faces: Array<{ vertices: Vec3[] }>) {
  const xs = faces.flatMap((face) => face.vertices.map((vertex) => vertex.x));
  const ys = faces.flatMap((face) => face.vertices.map((vertex) => vertex.y));

  return {
    height: Math.max(...ys) - Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
  };
}

function drawShadow(
  context: CanvasRenderingContext2D,
  size: number,
  bounds: ReturnType<typeof measureBounds>,
  scale: number,
  offsetX: number,
  offsetY: number,
) {
  const shadowCenterX = size / 2;
  const shadowCenterY = bounds.maxY * scale + offsetY + size * 0.02;
  const shadowWidth = Math.max(bounds.width * scale * 0.42, size * 0.18);
  const shadowHeight = Math.max(shadowWidth * 0.18, 3);

  context.save();
  context.fillStyle = "rgba(45, 26, 13, 0.18)";
  context.beginPath();
  context.ellipse(shadowCenterX, shadowCenterY, shadowWidth, shadowHeight, 0, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawTexturedQuad(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  uvs: Vec2[],
  vertices: Array<{ x: number; y: number }>,
) {
  drawTexturedTriangle(context, image, [uvs[0], uvs[1], uvs[2]], [vertices[0], vertices[1], vertices[2]]);
  drawTexturedTriangle(context, image, [uvs[0], uvs[2], uvs[3]], [vertices[0], vertices[2], vertices[3]]);
}

function drawTexturedTriangle(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  texturePoints: Vec2[],
  screenPoints: Array<{ x: number; y: number }>,
) {
  const [s0, s1, s2] = texturePoints.map((point) => ({
    u: point.u * image.width,
    v: point.v * image.height,
  }));
  const [p0, p1, p2] = screenPoints;
  const denominator = s0.u * (s1.v - s2.v) + s1.u * (s2.v - s0.v) + s2.u * (s0.v - s1.v);
  if (Math.abs(denominator) < 0.00001) {
    return;
  }

  const a = (p0.x * (s1.v - s2.v) + p1.x * (s2.v - s0.v) + p2.x * (s0.v - s1.v)) / denominator;
  const b = (p0.y * (s1.v - s2.v) + p1.y * (s2.v - s0.v) + p2.y * (s0.v - s1.v)) / denominator;
  const c = (p0.x * (s2.u - s1.u) + p1.x * (s0.u - s2.u) + p2.x * (s1.u - s0.u)) / denominator;
  const d = (p0.y * (s2.u - s1.u) + p1.y * (s0.u - s2.u) + p2.y * (s1.u - s0.u)) / denominator;
  const e =
    (p0.x * (s1.u * s2.v - s2.u * s1.v) + p1.x * (s2.u * s0.v - s0.u * s2.v) + p2.x * (s0.u * s1.v - s1.u * s0.v)) / denominator;
  const f =
    (p0.y * (s1.u * s2.v - s2.u * s1.v) + p1.y * (s2.u * s0.v - s0.u * s2.v) + p2.y * (s0.u * s1.v - s1.u * s0.v)) / denominator;

  context.save();
  context.beginPath();
  context.moveTo(p0.x, p0.y);
  context.lineTo(p1.x, p1.y);
  context.lineTo(p2.x, p2.y);
  context.closePath();
  context.clip();
  context.transform(a, b, c, d, e, f);
  context.drawImage(image, 0, 0);
  context.restore();
}

function shadeFace(context: CanvasRenderingContext2D, normal: Vec3, vertices: Array<{ x: number; y: number }>) {
  const brightness = dotProduct(normalizeVector(normal), FACE_LIGHT);
  const shadowAlpha = clamp(0.18 - brightness * 0.1, 0.04, 0.18);
  const highlightAlpha = clamp((brightness - 0.35) * 0.09, 0, 0.08);

  context.save();
  context.beginPath();
  context.moveTo(vertices[0].x, vertices[0].y);
  context.lineTo(vertices[1].x, vertices[1].y);
  context.lineTo(vertices[2].x, vertices[2].y);
  context.lineTo(vertices[3].x, vertices[3].y);
  context.closePath();
  context.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
  context.fill();

  if (highlightAlpha > 0) {
    context.fillStyle = `rgba(255, 255, 255, ${highlightAlpha})`;
    context.fill();
  }

  context.strokeStyle = "rgba(18, 11, 7, 0.12)";
  context.lineWidth = 0.6;
  context.stroke();
  context.restore();
}

function copyCanvas(target: HTMLCanvasElement, source: HTMLCanvasElement) {
  target.width = source.width;
  target.height = source.height;
  const context = target.getContext("2d");
  if (!context) {
    throw new Error("Could not access the preview canvas.");
  }

  context.clearRect(0, 0, target.width, target.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0);
}

function buildPreviewCacheKey(localId: string, size: PreviewSize) {
  const deviceScale = Math.max(window.devicePixelRatio || 1, PREVIEW_RENDER_SCALE[size]);
  return `${localId}:${size}:${deviceScale.toFixed(2)}`;
}

function loadTexture(source: string) {
  if (!textureCache.has(source)) {
    textureCache.set(
      source,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Could not load ${source}.`));
        image.src = source;
      }),
    );
  }

  return textureCache.get(source)!;
}

function createPartMatrix(part: MobModelPart) {
  const pose = part.pose;
  return multiplyMatrices(
    multiplyMatrices(
      multiplyMatrices(
        translationMatrix(pose.x / 16, pose.y / 16, pose.z / 16),
        multiplyMatrices(rotationZMatrix(pose.zRot), multiplyMatrices(rotationYMatrix(pose.yRot), rotationXMatrix(pose.xRot))),
      ),
      scaleMatrix(pose.xScale, pose.yScale, pose.zScale),
    ),
    IDENTITY_MATRIX,
  );
}

function translationMatrix(tx: number, ty: number, tz: number): Matrix4 {
  return [1, 0, 0, tx, 0, 1, 0, ty, 0, 0, 1, tz, 0, 0, 0, 1];
}

function scaleMatrix(sx: number, sy: number, sz: number): Matrix4 {
  return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
}

function rotationXMatrix(angle: number): Matrix4 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [1, 0, 0, 0, 0, cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1];
}

function rotationYMatrix(angle: number): Matrix4 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, 0, sin, 0, 0, 1, 0, 0, -sin, 0, cos, 0, 0, 0, 0, 1];
}

function rotationZMatrix(angle: number): Matrix4 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cos, -sin, 0, 0, sin, cos, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(a: Matrix4, b: Matrix4): Matrix4 {
  const result = new Array<number>(16).fill(0);

  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[row * 4 + column] += a[row * 4 + inner] * b[inner * 4 + column];
      }
    }
  }

  return result as Matrix4;
}

function transformPoint(matrix: Matrix4, vector: Vec3): Vec3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z + matrix[3],
    y: matrix[4] * vector.x + matrix[5] * vector.y + matrix[6] * vector.z + matrix[7],
    z: matrix[8] * vector.x + matrix[9] * vector.y + matrix[10] * vector.z + matrix[11],
  };
}

function transformVector(matrix: Matrix4, vector: Vec3): Vec3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[4] * vector.x + matrix[5] * vector.y + matrix[6] * vector.z,
    z: matrix[8] * vector.x + matrix[9] * vector.y + matrix[10] * vector.z,
  };
}

function normalizeVector(vector: Vec3) {
  const length = Math.hypot(vector.x, vector.y, vector.z) || 1;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function dotProduct(a: Vec3, b: Vec3) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
