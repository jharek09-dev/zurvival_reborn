export * from "./state/types.js";
export { createInitialState, type InitialStateOptions } from "./state/createInitialState.js";

// Seeded RNG — named streams (T5, DESIGN §9)
export { seedStreamState, stepFloat } from "./rng/prng.js";
export { drawFloat, drawInt, drawPick, type Draw } from "./rng/streams.js";

// Turn pipeline shell (T4, DESIGN §5)
export {
  applyAction,
  PIPELINE_STAGES,
  type Action,
  type Scene,
  type SceneChoice,
  type TurnResult,
} from "./pipeline/applyAction.js";

// World simulation — six independently-tickable layers, advanceable off-screen (T23, DESIGN §4/§5 · FR-SIM-01)
export {
  WORLD_SIM_LAYERS,
  getLayer,
  runLayer,
  tickWorld,
  advanceWorld,
  type SimContext,
  type SimLayer,
  type SimLayerId,
} from "./sim/worldSim.js";

// Per-turn change telemetry — the FR-CORE-04 no-no-op-turn audit (T13, DESIGN §11)
export {
  TRACKED_SYSTEMS,
  jsonEqual,
  diffSystems,
  auditTurn,
  type TrackedSystem,
  type TurnAudit,
} from "./telemetry/turnAudit.js";

// Save / load — versioned serialized GameState (T7, DESIGN §9)
export {
  saveGame,
  loadGame,
  serializeSave,
  describeSave,
  SaveError,
  SAVE_FORMAT,
  type SaveFile,
  type SaveMigration,
} from "./save/saveGame.js";

// Region & node graph, fog of war, world seeding (T11, DESIGN §4/§7)
export {
  MapError,
  buildRegionGraph,
  neighborsOf,
  areAdjacent,
  isDiscovered,
  isVisited,
  discoveredNodeIds,
  discoverAround,
  startRun,
  seedRegionState,
  seedNodeState,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
  type NodeMap,
  type RunStart,
} from "./map/index.js";

// Noise deposit model — loud actions leave sound in node memory (T14, DESIGN §5/§6 · FR-SIM-06)
export {
  NOISE_MOVE,
  NOISE_SEARCH,
  NOISE_REST,
  NOISE_DECAY_PER_HOUR,
  clampNoise,
  noiseOf,
  decayAllNoise,
  depositNoiseAt,
  updateNodeNoise,
} from "./sim/noise.js";

// Named wounds — treated, not regenerated (T16, DESIGN §6 · FR-INJ-01/04)
export {
  inflictWound,
  woundPlayer,
  treatWound,
  woundRemainder,
  woundBurden,
  isWounded,
  worstWound,
  type WoundDef,
} from "./sim/wounds.js";

// Avoidable combat, loud firearms, stealth path (T15, DESIGN §6 · FR-CBT-01/02/04/05)
export {
  hasLoadedFirearm,
  encounterChoices,
  combatChoices,
  resolveCombatAction,
  isCombatAction,
  combatNarration,
  detectChance,
  STRIKE_COST,
  FIRE_COST,
  SLIP_COST,
  RETREAT_COST,
  MELEE_NOISE,
  FIRE_NOISE,
  SLIP_NOISE,
  WALKER_ENEMY,
  WALKER_MAX_HP,
} from "./combat/combat.js";

// Survival pressure — needs bite, wounds decline, neglect ends the run (T22, DESIGN §6 · FR-CORE-02/FR-INJ)
export {
  updateCondition,
  driftNeeds,
  stageFor,
  eat,
  drink,
  treat,
  canEat,
  canDrink,
  canTreat,
  treatmentItem,
  runEndReason,
  isRunOver,
  endingNarration,
  HUNGER_RATE,
  THIRST_RATE,
  FATIGUE_RATE,
  NEED_FATAL,
  EAT_COST,
  DRINK_COST,
  TREAT_COST,
  EAT_RELIEF,
  DRINK_RELIEF,
  BITE_INFECT_RATE,
  INFECT_SYMPTOMATIC_AT,
  INFECT_TERMINAL_AT,
  FOOD_ITEM,
  WATER_ITEM,
  WOUND_EFFECTS,
  WOUND_TREATED_BY,
  MED_ITEMS,
  type WoundEffect,
  type RunEndReason,
} from "./sim/survival.js";

// Weight-limited inventory — the pack that forces a leave-behind (T18, DESIGN §6 · FR-PLR-03)
export {
  CARRY_CAPACITY,
  PACK_HEAVY,
  DEFAULT_ITEM_WEIGHT,
  ITEM_WEIGHTS,
  itemWeight,
  itemName,
  inventoryWeight,
  remainingCapacity,
  fits,
  addItemBounded,
  dropItem,
  type AddResult,
} from "./sim/inventory.js";

// Finite, contested, depleting loot economy (T17, DESIGN §6 · FR-ECO-01/02/03)
export {
  LOOT_TABLES,
  LOOT_CONTEST_DIVISOR,
  lootTableFor,
  searchYieldCap,
  resolveSearchLoot,
  contestRegion,
  updateRegionContest,
} from "./sim/loot.js";

// Off-screen regional drift — threat/density evolve with the player absent (T24, DESIGN §4 · FR-SIM-03)
export {
  driftRegions,
  driftRegion,
  equilibriumDensity,
  threatTarget,
  DENSITY_HOURS_PER_STEP,
  THREAT_HOURS_PER_STEP,
  DRIFT_JITTER,
} from "./sim/regionDrift.js";

// Zombie state machine + first distinct types (T25, DESIGN §6 · FR-CBT-06/07)
export {
  tickZombies,
  nextZombieState,
  desiredRung,
  stimulusAt,
  ZOMBIE_BEHAVIOUR,
  ZOMBIE_WALKER,
  ZOMBIE_SCREAMER,
  ZOMBIE_STALKER,
  WANDER_AT,
  INVESTIGATE_AT,
  CHASE_AT,
  SCREAM_NOISE,
  STALKER_NIGHT_BONUS,
  type ZombieBehaviour,
} from "./sim/zombies.js";

// Migrating hordes that re-path to noise (T26, DESIGN §5 · FR-SIM-07/FR-CBT-08)
export {
  tickHordes,
  seedStarterHordes,
  loudestAudible,
  STARTER_HORDE_SIZE,
  HORDE_SPEED,
  HORDE_AWARENESS,
  HORDE_HOURS_PER_STEP,
  REPATH_NOISE,
} from "./sim/hordes.js";

// Weather with multi-system effects (T27, DESIGN §6 · FR-SIM-05)
export {
  tickWeather,
  weatherEffect,
  weatherDetectionDelta,
  weatherNoiseFactor,
  WEATHER_EFFECTS,
  WEATHER_TRANSITIONS,
  WEATHER_CLEAR,
  WEATHER_RAIN,
  WEATHER_STORM,
  WEATHER_FOG,
  WEATHER_SNOW,
  WEATHER_WIND,
  WEATHER_CLOUDY,
  type WeatherEffect,
} from "./sim/weather.js";

// Core action loop — move/search/rest, time cost, scene (T12, DESIGN §5/§10)
export { phaseOf, advanceClock } from "./time/clock.js";
export {
  availableActions,
  assertLegal,
  applyPlayerAction,
  tickNeeds,
  sceneOf,
  IllegalActionError,
  MOVE_COST,
  SEARCH_COST,
  REST_COST,
  DROP_COST,
  SEARCH_GAIN,
  REST_RECOVERY,
} from "./actions/coreActions.js";
