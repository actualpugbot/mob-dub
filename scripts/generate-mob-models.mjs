import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..");
const datahubRoot = resolve(process.env.MOB_DUB_DATAHUB_ROOT ?? join(projectRoot, "..", "mc-datahub"));
const decompiledClientModelRoot = join(datahubRoot, "workspace", "versions", "26.1.1", "decompiled", "client", "net", "minecraft", "client", "model");
const decompiledRendererRoot = join(datahubRoot, "workspace", "versions", "26.1.1", "decompiled", "client", "net", "minecraft", "client", "renderer", "entity");
const outputPath = join(projectRoot, "public", "data", "mob-models.json");

const STUB_CLASS_NAMES = new Set([
  "CubeDeformation",
  "CubeListBuilder",
  "LayerDefinition",
  "Math",
  "MeshDefinition",
  "MeshTransformer",
  "Mth",
  "PartNames",
  "PartPose",
  "RandomSource",
]);

const MODEL_LAYER_OVERRIDES = {
  camel_husk: "CAMEL",
  donkey: "DONKEY",
  glow_squid: "GLOW_SQUID",
  mooshroom: "MOOSHROOM",
  mule: "MULE",
  piglin: "PIGLIN",
  piglin_brute: "PIGLIN_BRUTE",
  skeleton_horse: "SKELETON_HORSE",
  squid: "SQUID",
  trader_llama: "TRADER_LLAMA",
  wither: "WITHER",
  zombie_horse: "ZOMBIE_HORSE",
  zombified_piglin: "ZOMBIFIED_PIGLIN",
};

const LAYER_EXPR_ALIASES = {
  axolotlBodyLayer: "AdultAxolotlModel.createBodyLayer()",
  babyZombieLayer: "BabyZombieModel.createBodyLayer(CubeDeformation.NONE)",
  camelBodyLayer: "AdultCamelModel.createBodyLayer()",
  chickenBodyLayer: "AdultChickenModel.createBodyLayer()",
  cowBodyLayer: "CowModel.createBodyLayer()",
  dolphinBodyLayer: "DolphinModel.createBodyLayer()",
  felineBodyLayer: "LayerDefinition.create(AdultFelineModel.createBodyMesh(CubeDeformation.NONE), 64, 32)",
  giantScale: "MeshTransformer.scaling(6.0)",
  hoglinLayer: "HoglinModel.createBodyLayer()",
  horseBodyLayer: "LayerDefinition.create(AbstractEquineModel.createBodyMesh(CubeDeformation.NONE), 64, 64)",
  huskScale: "MeshTransformer.scaling(1.0625)",
  humanoidBodyLayer: "LayerDefinition.create(HumanoidModel.createMesh(CubeDeformation.NONE, 0.0), 64, 64)",
  illagerBodyLayer: "IllagerModel.createBodyLayer().apply(MeshTransformer.scaling(0.9375))",
  livingHorseScale: "MeshTransformer.scaling(1.1)",
  llamaBodyLayer: "LlamaModel.createBodyLayer(CubeDeformation.NONE)",
  pandaBodyLayer: "PandaModel.createBodyLayer()",
  pigBodyLayer: "PigModel.createBodyLayer(CubeDeformation.NONE)",
  piglinLayer: "AdultPiglinModel.createBodyLayer()",
  salmonBodyLayer: "SalmonModel.createBodyLayer()",
  sheepBodyLayer: "SheepModel.createBodyLayer()",
  skeletonBodyLayer: "SkeletonModel.createBodyLayer()",
  snifferBodyLayer: "SnifferModel.createBodyLayer()",
  spiderBodyLayer: "SpiderModel.createSpiderBodyLayer()",
  squidBodyLayer: "SquidModel.createBodyLayer()",
  striderLayer: "AdultStriderModel.createBodyLayer()",
  villagerBodyLayer: "LayerDefinition.create(VillagerModel.createBodyModel(), 64, 64).apply(MeshTransformer.scaling(0.9375))",
  villagerLikeScale: "MeshTransformer.scaling(0.9375)",
  witherSkeletonScale: "MeshTransformer.scaling(1.2)",
  wolfBodyLayer: "LayerDefinition.create(AdultWolfModel.createBodyLayer(CubeDeformation.NONE), 64, 32)",
  zombieVillagerBodyLayer: "ZombieVillagerModel.createBodyLayer()",
};

const MODEL_CLASS_FILE_OVERRIDES = {
  BlazeModel: "monster/blaze/BlazeModel.java",
  BoggedModel: "monster/skeleton/BoggedModel.java",
  BreezeModel: "monster/breeze/BreezeModel.java",
  CreeperModel: "monster/creeper/CreeperModel.java",
  CreakingModel: "monster/creaking/CreakingModel.java",
  EnderDragonModel: "monster/dragon/EnderDragonModel.java",
  EndermanModel: "monster/enderman/EndermanModel.java",
  EndermiteModel: "monster/endermite/EndermiteModel.java",
  GhastModel: "monster/ghast/GhastModel.java",
  GuardianModel: "monster/guardian/GuardianModel.java",
  HoglinModel: "monster/hoglin/HoglinModel.java",
  IllagerModel: "monster/illager/IllagerModel.java",
  MagmaCubeModel: "monster/slime/MagmaCubeModel.java",
  ShulkerModel: "monster/shulker/ShulkerModel.java",
  SilverfishModel: "monster/silverfish/SilverfishModel.java",
  SkeletonModel: "monster/skeleton/SkeletonModel.java",
  SlimeModel: "monster/slime/SlimeModel.java",
  SpiderModel: "monster/spider/SpiderModel.java",
  AdultPiglinModel: "monster/piglin/AdultPiglinModel.java",
  AdultZombifiedPiglinModel: "monster/piglin/AdultZombifiedPiglinModel.java",
  WitherBossModel: "monster/wither/WitherBossModel.java",
  WardenModel: "monster/warden/WardenModel.java",
  WitchModel: "monster/witch/WitchModel.java",
  DrownedModel: "monster/zombie/DrownedModel.java",
  BabyZombieModel: "monster/zombie/BabyZombieModel.java",
  GiantZombieModel: "monster/zombie/GiantZombieModel.java",
  ZombieVillagerModel: "monster/zombie/ZombieVillagerModel.java",
  VillagerModel: "npc/VillagerModel.java",
  AllayModel: "animal/allay/AllayModel.java",
  AdultArmadilloModel: "animal/armadillo/AdultArmadilloModel.java",
  AdultAxolotlModel: "animal/axolotl/AdultAxolotlModel.java",
  AdultBeeModel: "animal/bee/AdultBeeModel.java",
  AdultCamelModel: "animal/camel/AdultCamelModel.java",
  AdultChickenModel: "animal/chicken/AdultChickenModel.java",
  ColdChickenModel: "animal/chicken/ColdChickenModel.java",
  CowModel: "animal/cow/CowModel.java",
  DolphinModel: "animal/dolphin/DolphinModel.java",
  AbstractEquineModel: "animal/equine/AbstractEquineModel.java",
  DonkeyModel: "animal/equine/DonkeyModel.java",
  AdultCatModel: "animal/feline/AdultCatModel.java",
  AdultFelineModel: "animal/feline/AdultFelineModel.java",
  CodModel: "animal/fish/CodModel.java",
  PufferfishBigModel: "animal/fish/PufferfishBigModel.java",
  SalmonModel: "animal/fish/SalmonModel.java",
  TropicalFishSmallModel: "animal/fish/TropicalFishSmallModel.java",
  AdultFoxModel: "animal/fox/AdultFoxModel.java",
  FrogModel: "animal/frog/FrogModel.java",
  TadpoleModel: "animal/frog/TadpoleModel.java",
  HappyGhastModel: "animal/ghast/HappyGhastModel.java",
  GoatModel: "animal/goat/GoatModel.java",
  IronGolemModel: "animal/golem/IronGolemModel.java",
  SnowGolemModel: "animal/golem/SnowGolemModel.java",
  LlamaModel: "animal/llama/LlamaModel.java",
  NautilusModel: "animal/nautilus/NautilusModel.java",
  PandaModel: "animal/panda/PandaModel.java",
  ParrotModel: "animal/parrot/ParrotModel.java",
  PigModel: "animal/pig/PigModel.java",
  PolarBearModel: "animal/polarbear/PolarBearModel.java",
  AdultRabbitModel: "animal/rabbit/AdultRabbitModel.java",
  SheepModel: "animal/sheep/SheepModel.java",
  SnifferModel: "animal/sniffer/SnifferModel.java",
  SquidModel: "animal/squid/SquidModel.java",
  AdultTurtleModel: "animal/turtle/AdultTurtleModel.java",
  AdultWolfModel: "animal/wolf/AdultWolfModel.java",
  BatModel: "ambient/BatModel.java",
  HumanoidModel: "HumanoidModel.java",
};

async function main() {
  const dataset = JSON.parse(await readFile(join(projectRoot, "public", "data", "mob-sounds.json"), "utf8"));
  const rendererRegistry = await readFile(join(decompiledRendererRoot, "EntityRenderers.java"), "utf8");
  const layerDefinitions = await readFile(join(datahubRoot, "workspace", "versions", "26.1.1", "decompiled", "client", "net", "minecraft", "client", "model", "geom", "LayerDefinitions.java"), "utf8");
  const classLoader = createJavaStaticLoader();
  const mobModels = {};

  for (const mob of dataset.mobs) {
    let layerKey = "";
    let expression = "";

    try {
      layerKey = await resolveLayerKey(mob.localId, rendererRegistry);
      expression = resolveLayerExpression(layerKey, layerDefinitions);
      const definition = await evaluateLayerExpression(expression, classLoader);

      mobModels[mob.localId] = serializeLayerDefinition(definition);
    } catch (error) {
      throw new Error(
        `Failed to generate ${mob.localId} (${layerKey || "unknown layer"}): ${error instanceof Error ? error.message : String(error)}${
          expression ? `\nExpression: ${expression}` : ""
        }`,
      );
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify({ mobs: mobModels }, null, 2));
  console.log(`Wrote mob model previews to ${outputPath}`);
}

async function resolveLayerKey(localId, rendererRegistry) {
  if (MODEL_LAYER_OVERRIDES[localId]) {
    return MODEL_LAYER_OVERRIDES[localId];
  }

  const entityType = localId.toUpperCase();
  const block = findRegisterBlock(rendererRegistry, entityType);
  const selectedLayer = selectPrimaryLayer([...block.matchAll(/ModelLayers\.([A-Z0-9_]+)/g)].map((match) => match[1]));

  if (selectedLayer) {
    return selectedLayer;
  }

  const rendererClass = extractRendererClassName(block);
  if (!rendererClass) {
    throw new Error(`Could not resolve a renderer class for ${localId}.`);
  }

  const rendererSource = await readRendererSource(rendererClass);
  const rendererLayer = selectPrimaryLayer([...rendererSource.matchAll(/ModelLayers\.([A-Z0-9_]+)/g)].map((match) => match[1]));

  if (!rendererLayer) {
    throw new Error(`Could not resolve a primary model layer for ${localId}.`);
  }

  return rendererLayer;
}

function resolveLayerExpression(layerKey, layerDefinitions) {
  const putMatch = layerDefinitions.match(new RegExp(`result\\.put\\(ModelLayers\\.${layerKey},\\s*([^;]+)\\);`));
  if (!putMatch) {
    throw new Error(`Could not resolve a layer factory for ${layerKey}.`);
  }

  return expandLayerExpression(putMatch[1].trim(), layerDefinitions);
}

function expandLayerExpression(expression, layerDefinitions) {
  let next = expression;

  while (true) {
    const replaced = next.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match, identifier) => {
      const resolvedExpression = resolveLayerAlias(identifier, layerDefinitions);
      if (!resolvedExpression) {
        return match;
      }

      return `(${resolvedExpression})`;
    });

    if (replaced === next) {
      return replaced;
    }

    next = replaced;
  }
}

function resolveLayerAlias(identifier, layerDefinitions) {
  if (identifier in LAYER_EXPR_ALIASES) {
    return expandLayerExpression(LAYER_EXPR_ALIASES[identifier], layerDefinitions);
  }

  const localDefinitionMatch = layerDefinitions.match(
    new RegExp(`(?:^|\\n)\\s*(?:(?:final)\\s+)?(?:[A-Za-z_][A-Za-z0-9_<>,?. ]*?)\\s+${identifier}\\s*=\\s*([^;]+);`),
  );
  if (!localDefinitionMatch) {
    return null;
  }

  return expandLayerExpression(localDefinitionMatch[1].trim(), layerDefinitions);
}

function createJavaStaticLoader() {
  const fileCache = new Map();
  const moduleCache = new Map();
  const modelFileIndexPromise = indexJavaFiles(decompiledClientModelRoot);

  return {
    async getSource(className) {
      const relativePath = await this.resolveRelativePath(className);
      if (!fileCache.has(relativePath)) {
        fileCache.set(relativePath, readFile(join(decompiledClientModelRoot, relativePath), "utf8"));
      }

      return fileCache.get(relativePath);
    },
    async resolveRelativePath(className) {
      const fileIndex = await modelFileIndexPromise;
      const relativePath = MODEL_CLASS_FILE_OVERRIDES[className] ?? fileIndex.get(`${className}.java`);
      if (!relativePath) {
        throw new Error(`No source file override for ${className}.`);
      }

      return relativePath;
    },
    async load(className, requestedMembers = []) {
      if (STUB_CLASS_NAMES.has(className)) {
        return null;
      }

      const relativePath = await this.resolveRelativePath(className);
      if (!fileCache.has(relativePath)) {
        fileCache.set(relativePath, readFile(join(decompiledClientModelRoot, relativePath), "utf8"));
      }

      const cacheKey = `${className}:${[...new Set(requestedMembers)].sort().join(",")}`;
      if (moduleCache.has(cacheKey)) {
        return moduleCache.get(cacheKey);
      }

      return fileCache.get(relativePath).then((source) => {
        const module = buildJavaStaticsModule(source, className, this, requestedMembers);
        moduleCache.set(cacheKey, module);
        return module;
      });
    },
  };
}

async function indexJavaFiles(root, current = root, index = new Map()) {
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = join(current, entry.name);

    if (entry.isDirectory()) {
      await indexJavaFiles(root, absolutePath, index);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".java") && !index.has(entry.name)) {
      index.set(entry.name, absolutePath.slice(root.length + 1));
    }
  }

  return index;
}

async function buildJavaStaticsModule(source, className, loader, requestedMembers = []) {
  const classBody = extractClassBody(source, className);
  const staticMembers = extractStaticMembers(classBody);
  const memberMap = new Map(staticMembers.map((member) => [extractMemberName(member.source, member.type), member]));
  const selectedMemberNames = resolveSelectedStaticMembers(memberMap, requestedMembers);
  const selectedMembers = selectedMemberNames.map((memberName) => memberMap.get(memberName)).filter(Boolean);
  const dependencyAccesses = new Map();
  const definitions = [];

  for (const member of selectedMembers) {
    if (member.type === "field") {
      const { code, dependencies } = transpileStaticField(member.source);
      definitions.push(code);
      mergeDependencyAccesses(dependencyAccesses, dependencies);
      continue;
    }

    const { code, dependencies } = transpileStaticMethod(member.source);
    definitions.push(code);
    mergeDependencyAccesses(dependencyAccesses, dependencies);
  }

  const inheritedBindings = await resolveInheritedBindings(source, className, selectedMembers, memberMap, loader);
  const dependencies = [...dependencyAccesses.entries()].filter(([dependencyClass]) => dependencyClass !== className && !STUB_CLASS_NAMES.has(dependencyClass));
  const loadedModules = await Promise.all(dependencies.map(([dependencyClass, dependencyMembers]) => loader.load(dependencyClass, [...dependencyMembers])));
  const runtime = createJavaRuntime();
  const scope = {
    ...runtime,
    ...inheritedBindings,
  };

  for (let index = 0; index < dependencies.length; index += 1) {
    scope[dependencies[index][0]] = loadedModules[index];
  }

  const exportedNames = selectedMembers.map((member) => extractMemberName(member.source, member.type));
  const evaluator = new Function(
    ...Object.keys(scope),
    `
${definitions.join("\n\n")}
return { ${exportedNames.join(", ")} };
    `,
  );

  return evaluator(...Object.values(scope));
}

function createJavaRuntime() {
  class CubeDeformation {
    static NONE = new CubeDeformation(0);

    constructor(growX, growY = growX, growZ = growX) {
      this.growX = growX;
      this.growY = growY;
      this.growZ = growZ;
    }

    extend(growX, growY = growX, growZ = growX) {
      return new CubeDeformation(this.growX + growX, this.growY + growY, this.growZ + growZ);
    }
  }

  class CubeListBuilder {
    static create() {
      return new CubeListBuilder();
    }

    constructor() {
      this.cubes = [];
      this.mirrorState = false;
      this.textureU = 0;
      this.textureV = 0;
    }

    texOffs(textureU, textureV) {
      this.textureU = textureU;
      this.textureV = textureV;
      return this;
    }

    mirror(nextState = true) {
      this.mirrorState = nextState;
      return this;
    }

    addBox(...args) {
      let id = null;
      let nextArgs = args;

      if (typeof nextArgs[0] === "string") {
        [id, ...nextArgs] = nextArgs;
      }

      const [x, y, z, width, height, depth, deformation] = nextArgs;

      this.cubes.push({
        d: depth,
        growX: deformation instanceof CubeDeformation ? deformation.growX : 0,
        growY: deformation instanceof CubeDeformation ? deformation.growY : 0,
        growZ: deformation instanceof CubeDeformation ? deformation.growZ : 0,
        h: height,
        id,
        mirror: this.mirrorState,
        u: this.textureU,
        v: this.textureV,
        w: width,
        x,
        y,
        z,
      });

      return this;
    }
  }

  class PartDefinition {
    constructor(name, pose = createPose(0, 0, 0, 0, 0, 0, 1, 1, 1), cubes = []) {
      this.children = {};
      this.cubes = [...cubes];
      this.name = name;
      this.pose = pose;
    }

    addOrReplaceChild(name, builder, pose) {
      const child = new PartDefinition(name, pose, builder?.cubes ?? []);
      const previous = this.children[name];
      if (previous) {
        child.children = { ...previous.children };
      }
      this.children[name] = child;
      return child;
    }

    getChild(name) {
      return this.children[name];
    }

    retainPartsAndChildren(parts) {
      const allowed = parts instanceof Set ? parts : new Set(parts);
      for (const [name, child] of Object.entries(this.children)) {
        if (allowed.has(name)) {
          continue;
        }

        this.addOrReplaceChild(name, CubeListBuilder.create(), child.pose).retainPartsAndChildren(allowed);
      }
      return this;
    }

    retainExactParts(parts) {
      const allowed = parts instanceof Set ? parts : new Set(parts);
      for (const [name, child] of Object.entries(this.children)) {
        if (allowed.has(name)) {
          child.clearRecursively();
          continue;
        }

        this.addOrReplaceChild(name, CubeListBuilder.create(), child.pose).retainExactParts(allowed);
      }

      return this;
    }

    clearChild(name) {
      delete this.children[name];
      return this;
    }

    clearRecursively() {
      this.children = {};
      this.cubes = [];
      return this;
    }

    transformed(transformer) {
      const transformedPart = new PartDefinition(this.name, transformer(this.pose), this.cubes);
      transformedPart.children = { ...this.children };
      return transformedPart;
    }
  }

  class MeshDefinition {
    constructor() {
      this.root = new PartDefinition("root");
    }

    getRoot() {
      return this.root;
    }
  }

  class MeshTransformer {
    static scaling(scale) {
      return {
        applyToLayer(layer) {
          layer.root.pose = createPose(0, 0, 0, 0, 0, 0, scale, scale, scale);
          return layer;
        },
      };
    }
  }

  class LayerDefinition {
    static create(mesh, textureWidth, textureHeight) {
      return new LayerDefinition(mesh.getRoot(), textureWidth, textureHeight);
    }

    constructor(root, textureWidth, textureHeight) {
      this.root = root;
      this.textureWidth = textureWidth;
      this.textureHeight = textureHeight;
    }

    apply(transformer) {
      if (transformer?.applyToLayer) {
        return transformer.applyToLayer(this);
      }

      return this;
    }
  }

  const PartPose = {
    ZERO: createPose(0, 0, 0, 0, 0, 0, 1, 1, 1),
    offset: (x, y, z) => createPose(x, y, z, 0, 0, 0, 1, 1, 1),
    offsetAndRotation: (x, y, z, xRot, yRot, zRot) => createPose(x, y, z, xRot, yRot, zRot, 1, 1, 1),
    rotation: (xRot, yRot, zRot) => createPose(0, 0, 0, xRot, yRot, zRot, 1, 1, 1),
  };

  const Mth = {
    cos: Math.cos,
    sin: Math.sin,
    sqrt: Math.sqrt,
  };

  const RandomSource = {
    createThreadLocalInstance(seed) {
      let state = Number(seed) >>> 0;
      return {
        nextInt(max) {
          state = (state * 1664525 + 1013904223) >>> 0;
          return state % max;
        },
      };
    },
  };

  const PartNames = {
    tentacle(index) {
      return `tentacle${index}`;
    },
  };

  function createPose(x, y, z, xRot, yRot, zRot, xScale, yScale, zScale) {
    return {
      x,
      y,
      z,
      xRot,
      yRot,
      zRot,
      xScale,
      yScale,
      zScale,
    };
  }

  return {
    CubeDeformation,
    CubeListBuilder,
    LayerDefinition,
    MeshDefinition,
    MeshTransformer,
    Mth,
    PartNames,
    PartPose,
    RandomSource,
    setOf: (...values) => new Set(values),
  };
}

async function evaluateLayerExpression(expression, loader) {
  const transpiledExpression = transpileJavaExpression(expression);
  const dependencyAccesses = collectDependencyAccesses(transpiledExpression);
  const dependencies = [...dependencyAccesses.entries()].filter(([className]) => !STUB_CLASS_NAMES.has(className));
  const loadedModules = await Promise.all(dependencies.map(([className, members]) => loader.load(className, [...members])));
  const runtime = createJavaRuntime();
  const scope = {
    ...runtime,
  };

  for (let index = 0; index < dependencies.length; index += 1) {
    scope[dependencies[index][0]] = loadedModules[index];
  }

  const evaluator = new Function(...Object.keys(scope), `return ${transpiledExpression};`);
  return evaluator(...Object.values(scope));
}

function serializeLayerDefinition(layerDefinition) {
  return {
    root: serializePart(layerDefinition.root),
    textureHeight: layerDefinition.textureHeight,
    textureWidth: layerDefinition.textureWidth,
  };
}

function serializePart(part) {
  return {
    children: Object.fromEntries(Object.entries(part.children).map(([key, value]) => [key, serializePart(value)])),
    cubes: part.cubes,
    pose: part.pose,
  };
}

function extractClassBody(source, className) {
  const classStart = source.indexOf(`class ${className}`);
  if (classStart === -1) {
    throw new Error(`Could not locate class ${className}.`);
  }

  const openingBrace = source.indexOf("{", classStart);
  let depth = 1;
  let index = openingBrace + 1;

  while (depth > 0 && index < source.length) {
    const character = source[index];
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
    }

    index += 1;
  }

  return source.slice(openingBrace + 1, index - 1);
}

function extractStaticMembers(classBody) {
  const members = [];
  const lines = classBody.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!/^\s*(?:(?:public|private|protected)\s+)?static\b/.test(lines[lineIndex])) {
      continue;
    }

    if (/\bstatic\s+(?:final\s+)?(?:class|enum|interface|record)\b/.test(lines[lineIndex])) {
      let depth = countBraces(lines[lineIndex]);
      while (depth > 0 && lineIndex + 1 < lines.length) {
        lineIndex += 1;
        depth += countBraces(lines[lineIndex]);
      }
      continue;
    }

    let snippet = lines[lineIndex];
    let braceDepth = countBraces(snippet);
    let sawOpeningBrace = snippet.includes("{");
    let sawTerminalSemicolon = snippet.trim().endsWith(";") && braceDepth === 0;

    while (!sawOpeningBrace && !sawTerminalSemicolon && lineIndex + 1 < lines.length) {
      lineIndex += 1;
      snippet += `\n${lines[lineIndex]}`;
      braceDepth += countBraces(lines[lineIndex]);
      sawOpeningBrace = sawOpeningBrace || lines[lineIndex].includes("{");
      sawTerminalSemicolon = snippet.trim().endsWith(";") && braceDepth === 0;
    }

    if (sawOpeningBrace) {
      const textBeforeBrace = snippet.slice(0, snippet.indexOf("{"));
      const isFieldDeclaration = textBeforeBrace.includes("=");

      if (isFieldDeclaration) {
        while (!(snippet.trim().endsWith(";") && braceDepth === 0) && lineIndex + 1 < lines.length) {
          lineIndex += 1;
          snippet += `\n${lines[lineIndex]}`;
          braceDepth += countBraces(lines[lineIndex]);
        }

        members.push({
          source: snippet,
          type: "field",
        });
        continue;
      }

      while (braceDepth > 0 && lineIndex + 1 < lines.length) {
        lineIndex += 1;
        snippet += `\n${lines[lineIndex]}`;
        braceDepth += countBraces(lines[lineIndex]);
      }

      members.push({
        source: snippet,
        type: "method",
      });
      continue;
    }

    while (!snippet.trim().endsWith(";") && lineIndex + 1 < lines.length) {
      lineIndex += 1;
      snippet += `\n${lines[lineIndex]}`;
    }

    members.push({
      source: snippet,
      type: "field",
    });
  }

  return members;
}

function countBraces(value) {
  return (value.match(/\{/g) ?? []).length - (value.match(/\}/g) ?? []).length;
}

async function resolveInheritedBindings(source, className, selectedMembers, memberMap, loader) {
  const bindingsByClass = new Map();
  let ancestorClassName = extractSuperClassName(source, className);

  while (ancestorClassName && !STUB_CLASS_NAMES.has(ancestorClassName)) {
    let ancestorSource;
    try {
      ancestorSource = await loader.getSource(ancestorClassName);
    } catch {
      break;
    }

    const ancestorClassBody = extractClassBody(ancestorSource, ancestorClassName);
    const ancestorStaticMembers = extractStaticMembers(ancestorClassBody);
    const ancestorMemberMap = new Map(ancestorStaticMembers.map((member) => [extractMemberName(member.source, member.type), member]));

    for (const member of selectedMembers) {
      for (const candidateName of ancestorMemberMap.keys()) {
        if (memberMap.has(candidateName)) {
          continue;
        }

        if (!new RegExp(`\\b${candidateName}\\b`).test(member.source)) {
          continue;
        }

        if (!bindingsByClass.has(ancestorClassName)) {
          bindingsByClass.set(ancestorClassName, new Set());
        }

        bindingsByClass.get(ancestorClassName).add(candidateName);
      }
    }

    ancestorClassName = extractSuperClassName(ancestorSource, ancestorClassName);
  }

  if (bindingsByClass.size === 0) {
    return {};
  }

  const inheritedBindings = {};

  for (const [ancestorName, memberNames] of bindingsByClass.entries()) {
    const ancestorModule = await loader.load(ancestorName, [...memberNames]);

    for (const memberName of memberNames) {
      inheritedBindings[memberName] = ancestorModule[memberName];
    }
  }

  return inheritedBindings;
}

function extractSuperClassName(source, className) {
  const classHeaderMatch = source.match(new RegExp(`class\\s+${className}(?:\\s*<[^>]+>)?\\s+extends\\s+([A-Za-z_][A-Za-z0-9_]*)`));
  return classHeaderMatch?.[1] ?? null;
}

function transpileStaticField(source) {
  const flattened = stripFloatSuffixes(stripCasts(source)).replace(/\s+/g, " ").trim();
  const nameMatch = flattened.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+);$/);
  if (!nameMatch) {
    throw new Error(`Could not transpile static field: ${source}`);
  }

  const [, name, valueSource] = nameMatch;
  const value = transpileJavaExpression(valueSource);

  return {
    code: `const ${name} = ${value};`,
    dependencies: collectDependencyAccesses(value),
  };
}

function transpileStaticMethod(source) {
  const openingBrace = source.indexOf("{");
  const signature = source.slice(0, openingBrace).replace(/\s+/g, " ").trim();
  const body = source.slice(openingBrace + 1, source.lastIndexOf("}"));
  const methodMatch = signature.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/);

  if (!methodMatch) {
    throw new Error(`Could not transpile static method: ${source}`);
  }

  const [, name, rawParameters] = methodMatch;
  const parameters = rawParameters
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.replace(/\bfinal\b/g, "").trim().split(/\s+/).pop());
  const nextBody = transpileJavaBody(body);

  return {
    code: `function ${name}(${parameters.join(", ")}) {\n${nextBody}\n}`,
      dependencies: collectDependencyAccesses(`${signature}\n${nextBody}`),
  };
}

function transpileJavaBody(source) {
  let next = transpileJavaExpression(source);

  next = next.replace(/for\s*\(\s*let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g, "for (let $1 =");
  next = next.replace(
    /(^|\n)(\s*)(?:final\s+)?(?:[A-Za-z_][A-Za-z0-9_<>\[\]\.,?]*\s+)+([A-Za-z_][A-Za-z0-9_]*)\s*=/g,
    "$1$2let $3 =",
  );
  next = next.replace(/\bfor\s*\(\s*int\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g, "for (let $1 =");

  return next;
}

function transpileJavaExpression(source) {
  return replaceJavaArrayInitializers(stripFloatSuffixes(stripCasts(source)))
    .replace(/new\s+[A-Za-z_][A-Za-z0-9_<>,?. ]*\[([^\]]+)\](?!\s*\[)/g, "new Array($1)")
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*->\s*\{/g, "($1) => {")
    .replace(/\(\s*([A-Za-z_,\s]+?)\s*\)\s*->\s*\{/g, "($1) => {")
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*->\s*([^;\n,]+)/g, "($1) => $2")
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)\b/g, "$1.$2")
    .replace(/Set\.of\(/g, "setOf(");
}

function replaceJavaArrayInitializers(source) {
  let next = source;
  const arrayInitializerPattern = /new\s+[A-Za-z_][A-Za-z0-9_<>,?. ]*(?:\[\])+\s*\{/;

  while (true) {
    const match = arrayInitializerPattern.exec(next);
    if (!match) {
      return next;
    }

    const braceStart = match.index + match[0].lastIndexOf("{");
    const braceEnd = findMatchingBrace(next, braceStart);
    const javaInitializer = next.slice(braceStart, braceEnd + 1);
    const jsInitializer = javaInitializer.replace(/\{/g, "[").replace(/\}/g, "]");
    next = `${next.slice(0, match.index)}${jsInitializer}${next.slice(braceEnd + 1)}`;
  }
}

function findMatchingBrace(source, startIndex) {
  let depth = 0;

  for (let index = startIndex; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error(`Could not find a matching brace in ${source.slice(startIndex, startIndex + 120)}`);
}

function stripCasts(source) {
  return source.replace(/\((float|int|double|boolean)\)\s*/g, "");
}

function stripFloatSuffixes(source) {
  return source.replace(/(-?\d+(?:\.\d+)?)(?:F|D|L)\b/g, "$1");
}

function collectDependencyAccesses(source) {
  const dependencies = new Map();

  for (const match of source.matchAll(/\b([A-Z][A-Za-z0-9_]+)\.([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const [, className, memberName] = match;
    if (!dependencies.has(className)) {
      dependencies.set(className, new Set());
    }

    dependencies.get(className).add(memberName);
  }

  return dependencies;
}

function extractMemberName(source, memberType) {
  if (memberType === "method") {
    const openingBrace = source.indexOf("{");
    const signature = (openingBrace === -1 ? source : source.slice(0, openingBrace)).replace(/\s+/g, " ").trim();
    const methodMatch = signature.match(/([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)$/);
    if (!methodMatch) {
      throw new Error(`Could not resolve a method name for ${source}`);
    }

    return methodMatch[1];
  }

  const flattened = source.replace(/\s+/g, " ").trim();
  const fieldMatch = flattened.match(/^\s*(?:(?:public|private|protected)\s+)?static\b[\s\S]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  if (!fieldMatch) {
    throw new Error(`Could not resolve a field name for ${source}`);
  }

  return fieldMatch[1];
}

function resolveSelectedStaticMembers(memberMap, requestedMembers) {
  if (requestedMembers.length === 0) {
    return [...memberMap.keys()];
  }

  const queue = [...new Set(requestedMembers)].filter((memberName) => memberMap.has(memberName));
  const selected = new Set(queue);

  while (queue.length > 0) {
    const memberName = queue.shift();
    const member = memberMap.get(memberName);
    if (!member) {
      continue;
    }

    for (const dependencyName of collectReferencedMemberNames(member.source, memberMap, memberName)) {
      if (selected.has(dependencyName)) {
        continue;
      }

      selected.add(dependencyName);
      queue.push(dependencyName);
    }
  }

  return [...selected];
}

function collectReferencedMemberNames(source, memberMap, currentMemberName) {
  const referenced = [];

  for (const candidateName of memberMap.keys()) {
    if (candidateName === currentMemberName) {
      continue;
    }

    if (new RegExp(`\\b${candidateName}\\b`).test(source)) {
      referenced.push(candidateName);
    }
  }

  return referenced;
}

function mergeDependencyAccesses(target, source) {
  for (const [className, members] of source.entries()) {
    if (!target.has(className)) {
      target.set(className, new Set());
    }

    const targetMembers = target.get(className);
    for (const memberName of members) {
      targetMembers.add(memberName);
    }
  }
}

function isAuxiliaryLayer(value) {
  return [
    "ARMOR",
    "BABY",
    "BIOLUMINESCENT",
    "COLLAR",
    "DECOR",
    "EYES",
    "HARNESS",
    "HEAD",
    "HEART",
    "OUTER",
    "PULSATING",
    "ROPES",
    "SADDLE",
    "SKULL",
    "TENDRILS",
    "WOOL",
  ].some((token) => value.includes(token));
}

function selectPrimaryLayer(values) {
  return values.find((value) => !isAuxiliaryLayer(value));
}

function extractRendererClassName(registerBlock) {
  const directConstructorMatch = registerBlock.match(/\bnew\s+([A-Z][A-Za-z0-9_]+Renderer)\s*\(/);
  if (directConstructorMatch) {
    return directConstructorMatch[1];
  }

  const methodReferenceMatch = registerBlock.match(/\b([A-Z][A-Za-z0-9_]+Renderer)::new\b/);
  if (methodReferenceMatch) {
    return methodReferenceMatch[1];
  }

  return null;
}

async function readRendererSource(rendererClass) {
  return readFile(join(decompiledRendererRoot, `${rendererClass}.java`), "utf8");
}

function findRegisterBlock(rendererRegistry, entityType) {
  const start = rendererRegistry.indexOf(`register(EntityType.${entityType}`);
  if (start === -1) {
    throw new Error(`Could not locate renderer registration for ${entityType}.`);
  }

  const end = rendererRegistry.indexOf(";", start);
  return rendererRegistry.slice(start, end + 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
