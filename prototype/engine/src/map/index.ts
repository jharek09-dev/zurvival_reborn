/** Map subsystem barrel — region/node graph, fog of war, world seeding (M1 · T11). */

export {
  MapError,
  type NodeDef,
  type RegionDef,
  type RegionGraph,
} from "./types.js";
export { buildRegionGraph, neighborsOf, areAdjacent } from "./regionGraph.js";
export {
  isDiscovered,
  isVisited,
  discoveredNodeIds,
  discoverAround,
  type NodeMap,
} from "./fogOfWar.js";
export {
  startRun,
  seedRegionState,
  seedNodeState,
  type RunStart,
} from "./seedWorld.js";
