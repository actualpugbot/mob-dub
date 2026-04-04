const MOB_VERSION_GROUPS = [
  { version: "Classic", ids: ["cat", "chicken", "creeper", "ghast", "pig", "skeleton", "villager", "witch", "zombie", "spider", "sheep"] },
  { version: "Alpha", ids: ["cow", "slime"] },
  { version: "Beta", ids: ["squid", "wolf", "cave_spider", "enderman", "silverfish"] },
  { version: "1.0", ids: ["blaze", "magma_cube", "mooshroom", "snow_golem", "ender_dragon"] },
  { version: "1.2.1", ids: ["ocelot", "iron_golem"] },
  { version: "1.4.2", ids: ["zombie_villager", "wither", "wither_skeleton", "bat"] },
  { version: "1.6.1", ids: ["horse", "donkey", "mule", "skeleton_horse", "zombie_horse"] },
  { version: "1.8", ids: ["endermite", "guardian", "elder_guardian", "rabbit"] },
  { version: "1.9", ids: ["shulker"] },
  { version: "1.10", ids: ["husk", "polar_bear", "stray"] },
  { version: "1.11", ids: ["llama", "vindicator", "evoker", "vex"] },
  { version: "1.12", ids: ["parrot", "illusioner"] },
  { version: "1.13", ids: ["phantom", "turtle", "cod", "salmon", "pufferfish", "tropical_fish", "drowned", "dolphin"] },
  { version: "1.14", ids: ["panda", "pillager", "ravager", "trader_llama", "wandering_trader", "fox"] },
  { version: "1.15", ids: ["bee"] },
  { version: "1.16", ids: ["hoglin", "piglin", "zombified_piglin", "strider", "zoglin"] },
  { version: "1.16.2", ids: ["piglin_brute"] },
  { version: "1.17", ids: ["axolotl", "glow_squid", "goat"] },
  { version: "1.19", ids: ["warden", "frog", "tadpole", "allay"] },
  { version: "1.20", ids: ["camel", "sniffer"] },
  { version: "1.20.5", ids: ["armadillo"] },
  { version: "1.21", ids: ["breeze", "bogged"] },
  { version: "1.21.4", ids: ["creaking"] },
  { version: "1.21.6", ids: ["happy_ghast"] },
  { version: "1.21.9", ids: ["copper_golem"] },
  { version: "1.21.11", ids: ["nautilus", "zombie_nautilus", "camel_husk", "parched"] },
];

const RECENT_VERSION_SET = new Set(["1.20", "1.20.5", "1.21", "1.21.4", "1.21.6", "1.21.9", "1.21.11"]);
const UNRELEASED_MOB_IDS = new Set(["illusioner"]);

export const MOB_RELEASE_METADATA_BY_LOCAL_ID = buildMobReleaseMetadata();

function buildMobReleaseMetadata() {
  const metadata = {};

  for (const group of MOB_VERSION_GROUPS) {
    for (const mobId of group.ids) {
      if (metadata[mobId]) {
        throw new Error(`Duplicate release metadata configured for ${mobId}.`);
      }

      metadata[mobId] = {
        introducedVersion: group.version,
        isRecent: RECENT_VERSION_SET.has(group.version),
        releaseStatus: UNRELEASED_MOB_IDS.has(mobId) ? "unreleased" : "released",
      };
    }
  }

  return metadata;
}
