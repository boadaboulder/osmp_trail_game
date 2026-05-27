const STAGE_COUNT = 6;
const MAX_GUESSES = 6;

const FIELD = {
  trlId: "OSMP.TrailsOSMP.TRLID",
  trailName: "OSMP.TrailsOSMP.TRAILNAME",
  objectId: "OSMP.TrailsOSMP.OBJECTID",
  dogReg: "OSMP.TrailsOSMP.DOGREGGEN",
};

const DIFFICULTY = {
  "young-to-hike": {
    id: "young-to-hike",
    label: "I'm Too Young to Hike",
    showBaseMap: true,
    showTrailhead: true,
    showHints: true,
    contiguous: true,
    northUp: true,
  },
  "not-too-steep": {
    id: "not-too-steep",
    label: "Hey, Not Too Steep",
    showBaseMap: false,
    showTrailhead: true,
    showHints: true,
    contiguous: true,
    northUp: true,
  },
  "hike-me-plenty": {
    id: "hike-me-plenty",
    label: "Hike Me Plenty",
    showBaseMap: false,
    showTrailhead: false,
    showHints: true,
    contiguous: true,
    northUp: true,
  },
  "ultra-vertical": {
    id: "ultra-vertical",
    label: "Ultra-Vertical",
    showBaseMap: false,
    showTrailhead: false,
    showHints: false,
    contiguous: true,
    northUp: true,
  },
  nighthike: {
    id: "nighthike",
    label: "Nighthike!",
    showBaseMap: false,
    showTrailhead: false,
    showHints: false,
    contiguous: false,
    northUp: false,
  },
};

const API_URL =
  "https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/TrailsNEW/MapServer/4/query" +
  "?where=1%3D1" +
  "&outFields=OSMP.TrailsOSMP.OBJECTID,OSMP.TrailsOSMP.TRLID,OSMP.TrailsOSMP.TRAILNAME,OSMP.TrailsOSMP.DOGREGGEN" +
  "&returnGeometry=true" +
  "&outSR=4326" +
  "&f=geojson";

const PROPERTY_API_URL =
  "https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/PropertiesView/MapServer/0/query" +
  "?where=1%3D1" +
  "&outFields=*" +
  "&outSR=4326" +
  "&f=json";

const MANAGEMENT_AREAS_API_URL =
  "https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/ManagementAreaDesignations/MapServer/0/query" +
  "?where=1%3D1" +
  "&outFields=*" +
  "&returnGeometry=true" +
  "&outSR=4326" +
  "&f=json";

const WILDLIFE_CLOSURES_API_URL =
  "https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/AllWildlifeClosures/MapServer/5/query" +
  "?where=1%3D1" +
  "&outFields=*" +
  "&returnGeometry=true" +
  "&outSR=4326" +
  "&f=json";

const TRAILHEAD_API_URL =
  "https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/TrailsNEW/MapServer/0/query" +
  "?where=1%3D1" +
  "&outFields=*" +
  "&returnGeometry=true" +
  "&outSR=4326" +
  "&f=json";

const LOCAL_DATA_URL = "./data/osmp_trails.geojson";

const state = {
  catalog: [],
  puzzle: null,
  displayNameByNormalized: new Map(),
  trailByNormalized: new Map(),
  difficulty: "hike-me-plenty",
  attemptsUsed: 0,
  revealStage: 1,
  solved: false,
  guesses: [],
  tileLayer: null,
  mapRotation: 0,
  trailheads: [],
  trailheadMarker: null,
  properties: [],
  gameMode: "trail",
  triviaScore: 0,
  managementAreas: [],
  wildlifeClosures: [],
  score: 0,
};

const dom = {
  generatedDate: document.getElementById("generated-date"),
  dateKey: document.getElementById("date-key"),
  attemptsUsed: document.getElementById("attempts-used"),
  revealStage: document.getElementById("reveal-stage"),
  difficultySelect: document.getElementById("difficulty-select"),
  form: document.getElementById("guess-form"),
  input: document.getElementById("guess-input"),
  options: document.getElementById("guess-options"),
  status: document.getElementById("status"),
  hint: document.getElementById("hint"),
  history: document.getElementById("guess-history"),
  gameEndPanel: document.getElementById("game-end-panel"),
  osmpLink: document.getElementById("osmp-link"),
  shareBtn: document.getElementById("share-btn"),
  shareFeedback: document.getElementById("share-feedback"),
  gameModeBadge: document.getElementById("game-mode-badge"),
  triviaPanel: document.getElementById("trivia-panel"),
  triviaQuestions: document.getElementById("trivia-questions"),
  triviaScoreDisplay: document.getElementById("trivia-score-display"),
  scoreDisplay: document.getElementById("score-display"),
};

let map;
let revealLayer;

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  bindEvents();
  initializeGame().catch((error) => {
    console.error(error);
    setStatus(`Failed to initialize game: ${error.message}`, "error");
  });
});

async function initializeGame() {
  dom.generatedDate.textContent = new Date().toISOString();

  setStatus("Loading trail data from OSMP...", "warning");

  const features = await fetchTrailFeatures();
  const catalog = buildTrailCatalog(features);

  if (!catalog.length) {
    throw new Error("No valid trails were generated from source data.");
  }

  catalog.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  state.catalog = catalog;

  // Fetch property data (non-blocking, defaults to trail mode if it fails)
  await fetchPropertyData().catch((error) => {
    console.warn("Failed to load property data:", error);
  });

  const dateKey = getUtcDateKey();
  dom.dateKey.textContent = dateKey;
  const puzzleMode = getPuzzleMode();

  // Determine game mode (trail or property) based on date
  if (puzzleMode === "daily" && state.properties.length > 0) {
    state.gameMode = determineGameMode(dateKey);
  } else {
    state.gameMode = "trail";
  }

  // Update UI badge
  if (state.gameMode === "property") {
    dom.gameModeBadge.textContent = "🏞️ Property Round";
    dom.gameModeBadge.style.color = "var(--accent-alt)";
  } else {
    dom.gameModeBadge.textContent = "🥾 Trail Round";
    dom.gameModeBadge.style.color = "var(--accent)";
  }

  // Select puzzle based on game mode
  if (state.gameMode === "property") {
    state.puzzle = selectProperty(state.properties, dateKey);
    state.puzzle.displayName = state.puzzle.name;
    state.puzzle.center = state.puzzle.centroid;
    populateGuessOptions(state.properties);
    dom.input.placeholder = "Type to filter property names";
  } else {
    state.puzzle = selectPuzzle(catalog, dateKey, puzzleMode);
    populateGuessOptions(catalog);
    dom.input.placeholder = "Type to filter trail names";
  }

  // Calculate rotation angle for nighthike mode (seeded by dateKey)
  const rotationSeed = hashString(dateKey + "-rotation");
  const rng = createSeededRandom(rotationSeed);
  state.mapRotation = 45 + Math.floor(rng() * 270); // Random angle between 45-315 degrees

  // Fetch trailhead data (await so marker is available on first render)
  await fetchTrailheadData().catch((error) => {
    console.warn("Failed to load trailhead data:", error);
  });

  // Pre-fetch trivia data so it's ready when game ends
  fetchTriviaData().catch((error) => {
    console.warn("Failed to pre-fetch trivia data:", error);
  });

  refreshUi();
  setHint("");
  updateMapForStage(state.revealStage);

  if (puzzleMode === "longest") {
    setStatus("Test mode active: longest trail selected. Type to filter trail names, then submit your guess.", "warning");
  } else {
    const modeLabel = state.gameMode === "property" ? "property" : "trail";
    setStatus(`Daily puzzle ready. Type to filter ${modeLabel} names, then submit your guess.`, "warning");
  }
}

function initMap() {
  map = L.map("map", {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    zoomSnap: 0.25,
    zoomDelta: 0.25,
    minZoom: 10,
    maxZoom: 18,
  }).setView([40.015, -105.27], 12);

  L.control
    .scale({
      position: "bottomleft",
      metric: true,
      imperial: false,
      maxWidth: 140,
    })
    .addTo(map);

  revealLayer = L.layerGroup().addTo(map);
}

function bindEvents() {
  dom.form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitGuess();
  });

  dom.difficultySelect.addEventListener("change", () => {
    state.difficulty = dom.difficultySelect.value;
    setHint("");
    refreshUi();
    updateMapForStage(state.revealStage);
  });

  dom.shareBtn.addEventListener("click", () => {
    shareScore();
  });
}

async function fetchTrailFeatures() {
  const failures = [];

  try {
    const payload = await fetchFeaturePayload(API_URL);
    console.log(`[OSMP] Trail API returned ${payload.features.length} features, DOGREGGEN sample: ${payload.features[0]?.properties?.["OSMP.TrailsOSMP.DOGREGGEN"]}`);
    return payload.features;
  } catch (error) {
    failures.push(`remote fetch blocked or failed (${error.message})`);
  }

  try {
    const payload = await fetchFeaturePayload(LOCAL_DATA_URL);
    console.warn("[OSMP] Fell back to local trail snapshot (no DOGREGGEN)");
    setStatus("Using local trail snapshot because remote fetch was unavailable.", "warning");
    return payload.features;
  } catch (error) {
    failures.push(`local snapshot unavailable (${error.message})`);
  }

  throw new Error(failures.join("; "));
}

async function fetchFeaturePayload(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.features)) {
    throw new Error("response did not contain a GeoJSON feature list");
  }

  return payload;
}

async function fetchTrailheadData() {
  try {
    const response = await fetch(TRAILHEAD_API_URL);
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.features)) {
      throw new Error("response did not contain features array");
    }

    // Parse Esri JSON format: features[].geometry = {x: lng, y: lat}
    state.trailheads = payload.features
      .filter((feature) => feature.geometry && feature.geometry.x != null && feature.geometry.y != null)
      .map((feature) => ({
        name: feature.attributes?.ACCESSNAME || "Unnamed Trailhead",
        accessId: feature.attributes?.ACCESSID,
        coords: [feature.geometry.x, feature.geometry.y], // [lng, lat]
      }));
    console.log(`[OSMP] Loaded ${state.trailheads.length} trailheads`);
  } catch (error) {
    console.warn("Trailhead data unavailable:", error);
    state.trailheads = [];
  }
}

function findClosestTrailhead(trailCenter) {
  if (!state.trailheads.length || !trailCenter) {
    return null;
  }

  let closest = null;
  let minDistance = Infinity;

  for (const trailhead of state.trailheads) {
    const distance = haversineMeters(trailCenter, trailhead.coords);
    if (distance < minDistance) {
      minDistance = distance;
      closest = trailhead;
    }
  }

  return closest;
}

async function fetchPropertyData() {
  try {
    const response = await fetch(PROPERTY_API_URL);
    if (!response.ok) {
      throw new Error(`request failed with status ${response.status}`);
    }

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.features)) {
      throw new Error("response did not contain features array");
    }

    // Parse Esri JSON format: features[].geometry.rings = polygon coordinates [lng, lat]
    // Need to flip to [lat, lng] for Leaflet
    state.properties = payload.features
      .filter((feature) => feature.geometry && feature.geometry.rings && feature.geometry.rings.length > 0)
      .map((feature) => {
        const rings = feature.geometry.rings.map((ring) =>
          ring.map((point) => [point[1], point[0]]) // Flip from [lng, lat] to [lat, lng]
        );
        
        // Calculate centroid from outer ring (rings[0])
        const outerRing = feature.geometry.rings[0];
        let sumLng = 0;
        let sumLat = 0;
        for (const point of outerRing) {
          sumLng += point[0];
          sumLat += point[1];
        }
        const centroid = [sumLng / outerRing.length, sumLat / outerRing.length];

        return {
          name: feature.attributes?.PropertyName || "Unnamed Property",
          normalizedName: normalizeName(feature.attributes?.PropertyName || ""),
          rings, // Leaflet-compatible [lat, lng] format
          centroid, // [lng, lat] for calculations
        };
      })
      .filter((prop) => prop.normalizedName); // Filter out unnamed properties
  } catch (error) {
    console.warn("Property data unavailable:", error);
    state.properties = [];
  }
}

function determineGameMode(dateKey) {
  // Hash the date key to determine if this should be a property round
  const hash = Math.abs(hashString(dateKey + "-mode"));
  // About 2 days per week should be property rounds
  return hash % 7 < 2 ? "property" : "trail";
}

function selectProperty(properties, dateKey) {
  if (!properties.length) {
    return null;
  }

  const seed = Math.abs(hashString(dateKey + "-property"));
  const index = seed % properties.length;
  return properties[index];
}

async function fetchTriviaData() {
  // Fetch management areas
  try {
    const response = await fetch(MANAGEMENT_AREAS_API_URL);
    console.log(`[OSMP] Management areas response status: ${response.status}`);
    if (response.ok) {
      const payload = await response.json();
      console.log(`[OSMP] Management areas raw features: ${payload?.features?.length || 0}`);
      if (payload && Array.isArray(payload.features)) {
        const withGeometry = payload.features.filter((feature) => feature.geometry && feature.geometry.rings && feature.geometry.rings.length > 0);
        console.log(`[OSMP] Management areas with geometry: ${withGeometry.length}`);
        state.managementAreas = withGeometry
          .map((feature) => {
            const rings = feature.geometry.rings[0]; // Outer ring in [lng, lat]
            let sumLng = 0;
            let sumLat = 0;
            for (const point of rings) {
              sumLng += point[0];
              sumLat += point[1];
            }
            const centroid = [sumLng / rings.length, sumLat / rings.length];

            return {
              name: feature.attributes?.Name || "Unnamed Area",
              managementArea: feature.attributes?.ManagementArea,
              centroid,
              rings: feature.geometry.rings,
            };
          });
      }
    }
  } catch (error) {
    console.warn("Management areas unavailable:", error);
    state.managementAreas = [];
  }
  console.log(`[OSMP] Management areas loaded: ${state.managementAreas.length}`);

  // Fetch wildlife closures
  try {
    const response = await fetch(WILDLIFE_CLOSURES_API_URL);
    console.log(`[OSMP] Wildlife closures response status: ${response.status}`);
    if (response.ok) {
      const payload = await response.json();
      console.log(`[OSMP] Wildlife closures raw features: ${payload?.features?.length || 0}`);
      if (payload && Array.isArray(payload.features)) {
        const withGeometry = payload.features.filter((feature) => feature.geometry && feature.geometry.rings && feature.geometry.rings.length > 0);
        console.log(`[OSMP] Wildlife closures with geometry: ${withGeometry.length}`);
        state.wildlifeClosures = withGeometry
          .map((feature) => {
            const rings = feature.geometry.rings[0]; // Outer ring in [lng, lat]
            let sumLng = 0;
            let sumLat = 0;
            for (const point of rings) {
              sumLng += point[0];
              sumLat += point[1];
            }
            const centroid = [sumLng / rings.length, sumLat / rings.length];

            return {
              name: feature.attributes?.ClosureName || "Unnamed Closure",
              species: feature.attributes?.Species,
              centroid,
            };
          });
      }
    }
  } catch (error) {
    console.warn("Wildlife closures unavailable:", error);
    state.wildlifeClosures = [];
  }
  console.log(`[OSMP] Wildlife closures loaded: ${state.wildlifeClosures.length}`);
}

function buildTrailCatalog(features) {
  const groups = new Map();

  for (const feature of features) {
    const properties = feature.properties || {};
    const trailName = String(properties[FIELD.trailName] || "").trim();
    const trlId = String(properties[FIELD.trlId] || "").trim();
    const dogReg = String(properties[FIELD.dogReg] || properties.DOGREGGEN || "").trim();
    const normalizedName = normalizeName(trailName);

    if (!trailName || !normalizedName) {
      continue;
    }

    const groupKey = `name:${normalizedName}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        id: groupKey,
        displayName: trailName,
        normalizedName,
        trlId,
        dogReg,
        features: [],
      });
    }

    // Prefer the longest display label when variants differ by punctuation/casing.
    if (trailName.length > groups.get(groupKey).displayName.length) {
      groups.get(groupKey).displayName = trailName;
    }

    groups.get(groupKey).features.push(feature);
  }

  const catalog = [];

  for (const trail of groups.values()) {
    const edges = geometryToEdges(trail.features);
    if (!edges.length) {
      continue;
    }

    const largest = pickLargestConnectedComponent(edges);
    const traversal = orderedTraversal(largest.edges, largest.adjacency);

    if (!traversal.orderedEdges.length) {
      continue;
    }

    const stages = buildRevealStages(traversal.orderedEdges, STAGE_COUNT);
    const scatteredStages = buildScatteredStages(traversal.orderedEdges, STAGE_COUNT, trail.normalizedName);
    if (stages.length !== STAGE_COUNT) {
      continue;
    }

    const bounds = coordinatesBounds(stages[STAGE_COUNT - 1].geometry.coordinates);
    if (!bounds) {
      continue;
    }

    catalog.push({
      id: trail.id,
      displayName: trail.displayName,
      normalizedName: trail.normalizedName,
      trlId: trail.trlId,
      dogReg: trail.dogReg || "Unknown",
      sortKey: `${trail.normalizedName}|${trail.displayName}`,
      stages,
      scatteredStages,
      bounds,
      center: boundsCenter(bounds),
      totalLengthMeters: traversal.totalLength,
      features: trail.features,
    });
  }

  return catalog;
}

function geometryToEdges(features) {
  const edges = [];
  let edgeCounter = 0;

  for (const feature of features) {
    const properties = feature.properties || {};
    const objectId = properties[FIELD.objectId] != null ? String(properties[FIELD.objectId]) : "oid";
    const geometry = feature.geometry;

    if (!geometry) {
      continue;
    }

    const lines = [];
    if (geometry.type === "LineString") {
      lines.push(geometry.coordinates);
    } else if (geometry.type === "MultiLineString") {
      for (const line of geometry.coordinates) {
        lines.push(line);
      }
    }

    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2) {
        continue;
      }

      const start = line[0];
      const end = line[line.length - 1];
      const startKey = pointKey(start);
      const endKey = pointKey(end);
      const edgeId = `${objectId}:${edgeCounter}`;

      edges.push({
        edgeId,
        startKey,
        endKey,
        coords: line.map((point) => [point[0], point[1]]),
        length: lineLengthMeters(line),
      });

      edgeCounter += 1;
    }
  }

  return edges;
}

function pickLargestConnectedComponent(edges) {
  const adjacency = new Map();

  for (const edge of edges) {
    if (!adjacency.has(edge.startKey)) {
      adjacency.set(edge.startKey, []);
    }
    if (!adjacency.has(edge.endKey)) {
      adjacency.set(edge.endKey, []);
    }

    adjacency.get(edge.startKey).push(edge);
    adjacency.get(edge.endKey).push(edge);
  }

  const edgeById = new Map(edges.map((edge) => [edge.edgeId, edge]));
  const seenEdgeIds = new Set();
  let bestComponent = [];
  let bestLength = -1;

  for (const edge of edges) {
    if (seenEdgeIds.has(edge.edgeId)) {
      continue;
    }

    const queue = [edge.startKey, edge.endKey];
    const componentEdgeIds = new Set();
    const seenNodes = new Set();

    while (queue.length) {
      const node = queue.shift();
      if (!node || seenNodes.has(node)) {
        continue;
      }
      seenNodes.add(node);

      const nodeEdges = adjacency.get(node) || [];
      for (const nextEdge of nodeEdges) {
        componentEdgeIds.add(nextEdge.edgeId);
        const otherNode = nextEdge.startKey === node ? nextEdge.endKey : nextEdge.startKey;
        if (!seenNodes.has(otherNode)) {
          queue.push(otherNode);
        }
      }
    }

    let componentLength = 0;
    for (const edgeId of componentEdgeIds) {
      const componentEdge = edgeById.get(edgeId);
      if (componentEdge) {
        componentLength += componentEdge.length;
        seenEdgeIds.add(edgeId);
      }
    }

    if (componentLength > bestLength) {
      bestLength = componentLength;
      bestComponent = Array.from(componentEdgeIds)
        .map((edgeId) => edgeById.get(edgeId))
        .filter(Boolean);
    }
  }

  const filteredAdjacency = new Map();
  for (const edge of bestComponent) {
    if (!filteredAdjacency.has(edge.startKey)) {
      filteredAdjacency.set(edge.startKey, []);
    }
    if (!filteredAdjacency.has(edge.endKey)) {
      filteredAdjacency.set(edge.endKey, []);
    }

    filteredAdjacency.get(edge.startKey).push(edge);
    filteredAdjacency.get(edge.endKey).push(edge);
  }

  return {
    edges: bestComponent,
    adjacency: filteredAdjacency,
  };
}

function orderedTraversal(edges, adjacency) {
  if (!edges.length) {
    return { orderedEdges: [], totalLength: 0 };
  }

  const visited = new Set();
  const orderedEdges = [];
  const totalLength = edges.reduce((sum, edge) => sum + edge.length, 0);

  function dfs(nodeKey) {
    const candidates = (adjacency.get(nodeKey) || [])
      .filter((edge) => !visited.has(edge.edgeId))
      .sort((a, b) => compareCandidate(nodeKey, a, b));

    for (const edge of candidates) {
      if (visited.has(edge.edgeId)) {
        continue;
      }

      visited.add(edge.edgeId);
      const forward = edge.startKey === nodeKey;
      const nextNode = forward ? edge.endKey : edge.startKey;

      orderedEdges.push({
        edgeId: edge.edgeId,
        length: edge.length,
        coords: forward ? edge.coords : [...edge.coords].reverse(),
      });

      dfs(nextNode);
    }
  }

  const startNode = pickStartNode(adjacency);
  dfs(startNode);

  // Safety fallback in case connectivity assumptions are violated.
  if (orderedEdges.length < edges.length) {
    const remaining = edges
      .filter((edge) => !visited.has(edge.edgeId))
      .sort((a, b) => a.edgeId.localeCompare(b.edgeId));

    for (const edge of remaining) {
      visited.add(edge.edgeId);
      orderedEdges.push({
        edgeId: edge.edgeId,
        length: edge.length,
        coords: edge.coords,
      });
    }
  }

  return { orderedEdges, totalLength };
}

function compareCandidate(nodeKey, edgeA, edgeB) {
  const otherA = edgeA.startKey === nodeKey ? edgeA.endKey : edgeA.startKey;
  const otherB = edgeB.startKey === nodeKey ? edgeB.endKey : edgeB.startKey;

  if (otherA !== otherB) {
    return otherA.localeCompare(otherB);
  }
  return edgeA.edgeId.localeCompare(edgeB.edgeId);
}

function pickStartNode(adjacency) {
  const degreeOne = [];
  const allNodes = [];

  for (const [node, incidentEdges] of adjacency.entries()) {
    allNodes.push(node);
    if (incidentEdges.length === 1) {
      degreeOne.push(node);
    }
  }

  const candidatePool = degreeOne.length ? degreeOne : allNodes;
  candidatePool.sort((a, b) => a.localeCompare(b));

  return candidatePool[0];
}

function buildRevealStages(orderedEdges, stageCount) {
  const totalLength = orderedEdges.reduce((sum, edge) => sum + edge.length, 0);
  if (totalLength <= 0) {
    return [];
  }

  const stages = [];

  for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
    const target = stageIndex === stageCount - 1 ? totalLength : ((stageIndex + 1) * totalLength) / stageCount;
    const stageLines = buildLinesUpToDistance(orderedEdges, target);

    stages.push({
      stage: stageIndex + 1,
      revealedLength: target,
      geometry: {
        type: "MultiLineString",
        coordinates: stageLines,
      },
    });
  }

  return stages;
}

function buildScatteredStages(orderedEdges, stageCount, seed) {
  // Create a shuffled order for edges using the seed
  const shuffledIndices = orderedEdges.map((_, i) => i);
  const rng = createSeededRandom(hashString(seed));
  
  // Fisher-Yates shuffle with seeded random
  for (let i = shuffledIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
  }
  
  const shuffledEdges = shuffledIndices.map(i => orderedEdges[i]);
  const totalLength = shuffledEdges.reduce((sum, edge) => sum + edge.length, 0);
  
  if (totalLength <= 0) {
    return [];
  }
  
  const stages = [];
  
  for (let stageIndex = 0; stageIndex < stageCount; stageIndex += 1) {
    const target = stageIndex === stageCount - 1 ? totalLength : ((stageIndex + 1) * totalLength) / stageCount;
    const stageLines = buildLinesUpToDistance(shuffledEdges, target);
    
    stages.push({
      stage: stageIndex + 1,
      revealedLength: target,
      geometry: {
        type: "MultiLineString",
        coordinates: stageLines,
      },
    });
  }
  
  return stages;
}

function createSeededRandom(seed) {
  let state = seed;
  return function() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function buildLinesUpToDistance(orderedEdges, targetDistanceMeters) {
  const lines = [];
  let remaining = targetDistanceMeters;

  for (const edge of orderedEdges) {
    if (remaining <= 0) {
      break;
    }

    if (edge.length <= remaining + 1e-6) {
      lines.push(edge.coords.map((point) => [point[0], point[1]]));
      remaining -= edge.length;
      continue;
    }

    const partial = cutLineByDistance(edge.coords, remaining);
    if (partial.length >= 2) {
      lines.push(partial);
    }
    remaining = 0;
  }

  return lines;
}

function cutLineByDistance(line, distanceMeters) {
  if (!Array.isArray(line) || line.length < 2 || distanceMeters <= 0) {
    return [];
  }

  const output = [line[0]];
  let traversed = 0;

  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1];
    const b = line[i];
    const segmentLength = haversineMeters(a, b);

    if (traversed + segmentLength <= distanceMeters + 1e-6) {
      output.push(b);
      traversed += segmentLength;
      continue;
    }

    const remaining = distanceMeters - traversed;
    const ratio = segmentLength > 0 ? Math.max(0, Math.min(1, remaining / segmentLength)) : 0;
    const lon = a[0] + (b[0] - a[0]) * ratio;
    const lat = a[1] + (b[1] - a[1]) * ratio;
    output.push([lon, lat]);
    return output;
  }

  return output;
}

function selectDailyTrail(catalog, dateKey) {
  const seed = Math.abs(hashString(dateKey));
  const index = seed % catalog.length;
  return catalog[index];
}

function selectLongestTrail(catalog) {
  if (!catalog.length) {
    return null;
  }

  return catalog.reduce((longest, trail) => {
    if (!longest || trail.totalLengthMeters > longest.totalLengthMeters) {
      return trail;
    }
    return longest;
  }, null);
}

function selectPuzzle(catalog, dateKey, mode) {
  if (mode === "longest") {
    return selectLongestTrail(catalog);
  }

  return selectDailyTrail(catalog, dateKey);
}

function getPuzzleMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = (params.get("puzzle") || "").trim().toLowerCase();

  if (mode === "longest") {
    return "longest";
  }

  return "daily";
}

function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return hash;
}

function getUtcDateKey() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Calculate name similarity score between a guess and the correct answer.
 * Returns a ratio of shared words to total words (0.0 to 1.0).
 */
/**
 * Calculate the final score based on guesses and trivia.
 * Trail guessing: 600 max (100 per guess remaining when solved)
 * Trivia: 400 max (100 per correct answer)
 */
function calculateScore() {
  // Trail guessing: 600 max (100 per guess remaining)
  // Trivia: 400 max (100 per correct answer)
  const TRAIL_MAX = 600;
  const POINTS_PER_REMAINING_GUESS = 100;
  const TRIVIA_POINTS_PER_QUESTION = 100;

  const guessesUsed = state.guesses.length;
  const guessesRemaining = MAX_GUESSES - guessesUsed;

  // Trail score: everyone gets points. Solved on guess 1 = 600, guess 2 = 500, etc.
  // Not solved = 0 trail points
  let trailScore;
  if (state.solved) {
    trailScore = POINTS_PER_REMAINING_GUESS * (guessesRemaining + 1); // +1 because solving counts
  } else {
    trailScore = 0;
  }
  trailScore = Math.min(trailScore, TRAIL_MAX);

  // Trivia score: 100 per correct answer
  const triviaBonus = state.triviaScore * TRIVIA_POINTS_PER_QUESTION;

  state.score = trailScore + triviaBonus;

  // Store breakdown for display
  state.scoreBreakdown = {
    trailScore,
    trailMax: TRAIL_MAX,
    triviaBonus,
    triviaMax: TRIVIA_POINTS_PER_QUESTION * 4,
    guessesUsed,
    solved: state.solved,
  };
}

/**
 * Display the score in the game end panel with breakdown.
 */
function displayScore() {
  if (!dom.scoreDisplay) {
    return;
  }

  const breakdown = state.scoreBreakdown;
  let breakdownText;

  if (breakdown.solved) {
    breakdownText = `Trail: ${breakdown.trailScore}/${breakdown.trailMax} (solved in ${breakdown.guessesUsed}) | Trivia: ${breakdown.triviaBonus}/${breakdown.triviaMax}`;
  } else {
    breakdownText = `Trail: 0/${breakdown.trailMax} (not solved) | Trivia: ${breakdown.triviaBonus}/${breakdown.triviaMax}`;
  }

  dom.scoreDisplay.innerHTML = `
    <strong>Score: ${state.score} / ${breakdown.trailMax + breakdown.triviaMax}</strong><br>
    <span class="score-breakdown">${breakdownText}</span>
  `;
}

function submitGuess() {
  if (!state.puzzle || state.solved || state.attemptsUsed >= MAX_GUESSES) {
    return;
  }

  const rawGuess = dom.input.value.trim();
  const normalized = normalizeName(rawGuess);
  const itemType = state.gameMode === "property" ? "property" : "trail";

  if (!normalized) {
    setStatus(`Type and select a ${itemType} name before submitting.`, "warning");
    return;
  }

  if (!state.displayNameByNormalized.has(normalized)) {
    setStatus(`Pick a valid ${itemType} from the dropdown list.`, "warning");
    return;
  }

  if (state.guesses.some((guess) => guess.normalized === normalized)) {
    setStatus(`You already guessed that ${itemType} name.`, "warning");
    return;
  }

  const guessLabel = state.displayNameByNormalized.get(normalized);
  const guessedItem = state.trailByNormalized.get(normalized);
  const correct = normalized === state.puzzle.normalizedName;
  const difficulty = DIFFICULTY[state.difficulty];
  const hintText = !correct && difficulty.showHints ? buildDirectionalHint(guessedItem, state.puzzle) : "";
  state.guesses.push({ text: guessLabel, normalized, correct, hint: hintText });

  // Disable difficulty selector after first guess
  if (state.guesses.length === 1) {
    dom.difficultySelect.disabled = true;
  }

  if (correct) {
    state.solved = true;
    state.revealStage = STAGE_COUNT;
    refreshUi();
    setHint("");
    updateMapForStage(state.revealStage);
    setStatus(`Correct. The ${itemType} is ${state.puzzle.displayName}.`, "success");
    dom.form.querySelector("button").disabled = true;
    dom.input.disabled = true;
    showGameEndPanel();
    return;
  }

  setHint(difficulty.showHints ? hintText : "");

  state.attemptsUsed += 1;

  if (state.attemptsUsed >= MAX_GUESSES) {
    state.revealStage = STAGE_COUNT;
    refreshUi();
    updateMapForStage(state.revealStage);
    setStatus(`No guesses left. The ${itemType} was ${state.puzzle.displayName}.`, "error");
    dom.form.querySelector("button").disabled = true;
    dom.input.disabled = true;
    showGameEndPanel();
  } else {
    if (state.gameMode === "trail") {
      state.revealStage = Math.min(STAGE_COUNT, state.revealStage + 1);
      refreshUi();
      updateMapForStage(state.revealStage);
      setStatus("Not a match. Next contiguous segment is now revealed.", "warning");
    } else {
      // Property mode: no progressive reveal, just show feedback
      refreshUi();
      setStatus("Not a match. Try again!", "warning");
    }
  }

  dom.input.value = "";
  dom.input.focus();
}

function populateGuessOptions(catalog) {
  state.displayNameByNormalized = new Map();
  state.trailByNormalized = new Map();

  const options = [...catalog].sort((a, b) => {
    const nameA = a.displayName || a.name || "";
    const nameB = b.displayName || b.name || "";
    return nameA.localeCompare(nameB);
  });

  dom.options.innerHTML = "";

  for (const item of options) {
    const normalized = item.normalizedName;
    const displayName = item.displayName || item.name;
    if (!normalized || state.displayNameByNormalized.has(normalized)) {
      continue;
    }

    state.displayNameByNormalized.set(normalized, displayName);
    state.trailByNormalized.set(normalized, item);

    const option = document.createElement("option");
    option.value = displayName;
    dom.options.appendChild(option);
  }

  dom.input.value = "";
  dom.input.disabled = false;
  dom.form.querySelector("button").disabled = false;
}

function updateMapForStage(stageNumber) {
  if (!state.puzzle) {
    return;
  }

  const difficulty = DIFFICULTY[state.difficulty];
  const clampedStage = Math.max(1, Math.min(stageNumber, STAGE_COUNT));

  revealLayer.clearLayers();

  // Add or remove base map tiles based on difficulty
  if (difficulty.showBaseMap) {
    if (!state.tileLayer) {
      state.tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "",
        maxZoom: 19,
      }).addTo(map);
    }
  } else {
    if (state.tileLayer) {
      map.removeLayer(state.tileLayer);
      state.tileLayer = null;
    }
  }

  // Add trailhead marker for difficulty levels with showTrailhead: true (trail mode only)
  if (state.trailheadMarker) {
    revealLayer.removeLayer(state.trailheadMarker);
    state.trailheadMarker = null;
  }

  if (state.gameMode === "trail" && difficulty.showTrailhead && state.trailheads.length) {
    const closestTrailhead = findClosestTrailhead(state.puzzle.center);
    console.log(`[OSMP] Closest trailhead: ${closestTrailhead?.name} for puzzle center: ${state.puzzle.center}`);
    if (closestTrailhead) {
      state.trailheadMarker = L.marker([closestTrailhead.coords[1], closestTrailhead.coords[0]], {
        icon: L.icon({
          iconUrl: "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png",
          shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
          iconSize: [25, 41],
          iconAnchor: [12, 41],
          popupAnchor: [1, -34],
          shadowSize: [41, 41],
        }),
      }).addTo(revealLayer);

      state.trailheadMarker.bindTooltip(closestTrailhead.name, {
        permanent: false,
        direction: "top",
      });
    }
  }

  // Apply or remove map rotation based on difficulty
  const mapElement = document.getElementById("map");
  if (!difficulty.northUp) {
    mapElement.classList.add("map-rotated");
    mapElement.style.transform = `rotate(${state.mapRotation}deg)`;
  } else {
    mapElement.classList.remove("map-rotated");
    mapElement.style.transform = "";
  }

  // Render property or trail based on game mode
  if (state.gameMode === "property") {
    // Property mode: show full polygon outline immediately
    const polygon = L.polygon(state.puzzle.rings, {
      color: "#009e73",
      weight: 3,
      opacity: 0.8,
      fill: false,
    }).addTo(revealLayer);

    // Calculate bounds from rings
    const bounds = polygon.getBounds();
    state.puzzle.bounds = [[bounds.getSouth(), bounds.getWest()], [bounds.getNorth(), bounds.getEast()]];

    map.fitBounds(bounds, {
      padding: [24, 24],
      animate: false,
    });
  } else {
    // Trail mode: progressive reveal by stages
    const stageList = difficulty.contiguous ? state.puzzle.stages : state.puzzle.scatteredStages;
    const stage = stageList[clampedStage - 1];

    const geo = L.geoJSON(stage.geometry, {
      style: {
        color: "#0072b2",
        weight: 5,
        opacity: 0.95,
        lineCap: "round",
      },
    }).addTo(revealLayer);

    // Keep scale anchored to the final trail footprint, not the currently revealed subset.
    const fullBounds = state.puzzle.bounds;
    if (fullBounds) {
      const mapBounds = L.latLngBounds(
        [fullBounds[0][0], fullBounds[0][1]],
        [fullBounds[1][0], fullBounds[1][1]]
      );

      // Extend bounds to include trailhead marker if visible
      if (difficulty.showTrailhead && state.trailheadMarker) {
        mapBounds.extend(state.trailheadMarker.getLatLng());
      }

      map.fitBounds(mapBounds, {
        padding: [24, 24],
        animate: false,
      });
    }
  }
}

function refreshUi() {
  dom.attemptsUsed.textContent = String(state.attemptsUsed);
  dom.revealStage.textContent = String(state.revealStage);

  const difficulty = DIFFICULTY[state.difficulty];
  dom.history.innerHTML = "";
  for (const guess of state.guesses) {
    const item = document.createElement("li");
    if (guess.correct || !difficulty.showHints || !guess.hint) {
      item.textContent = guess.text;
    } else {
      item.textContent = `${guess.text} -> ${guess.hint}`;
    }
    item.className = guess.correct ? "correct" : "incorrect";
    dom.history.appendChild(item);
  }
}

function setStatus(message, tone) {
  dom.status.textContent = message;
  dom.status.classList.remove("error", "success", "warning");
  if (tone) {
    dom.status.classList.add(tone);
  }
}

function setHint(message) {
  dom.hint.textContent = message;
}

function buildDirectionalHint(fromTrail, targetTrail) {
  if (!fromTrail || !targetTrail) {
    return "Hint unavailable for this guess.";
  }

  const fromCenter = fromTrail.center || fromTrail.centroid;
  const targetCenter = targetTrail.center || targetTrail.centroid;
  if (!fromCenter || !targetCenter) {
    return "Hint unavailable for this guess.";
  }

  const fromLon = fromCenter[0];
  const fromLat = fromCenter[1];
  const targetLon = targetCenter[0];
  const targetLat = targetCenter[1];

  const averageLatRadians = ((fromLat + targetLat) / 2) * (Math.PI / 180);
  const northSouthMiles = (targetLat - fromLat) * 69.172;
  const eastWestMiles = (targetLon - fromLon) * 69.172 * Math.cos(averageLatRadians);

  const nsDirection = northSouthMiles >= 0 ? "north" : "south";
  const ewDirection = eastWestMiles >= 0 ? "east" : "west";
  const nsDistance = formatImperialDistance(Math.abs(northSouthMiles));
  const ewDistance = formatImperialDistance(Math.abs(eastWestMiles));

  const fromName = fromTrail.displayName || fromTrail.name || "your guess";
  return `Hint: target is ${nsDistance} ${nsDirection} and ${ewDistance} ${ewDirection} of ${fromName}.`;
}

function formatImperialDistance(miles) {
  if (!Number.isFinite(miles)) {
    return "0 ft";
  }

  if (miles < 0.2) {
    const feet = Math.round((miles * 5280) / 10) * 10;
    return `${Math.max(0, feet)} ft`;
  }

  if (miles < 10) {
    return `${miles.toFixed(2)} mi`;
  }

  return `${miles.toFixed(1)} mi`;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pointKey(point) {
  const lng = Number(point[0]).toFixed(6);
  const lat = Number(point[1]).toFixed(6);
  return `${lng},${lat}`;
}

function lineLengthMeters(line) {
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    total += haversineMeters(line[i - 1], line[i]);
  }
  return total;
}

function haversineMeters(a, b) {
  const toRadians = Math.PI / 180;
  const lon1 = a[0] * toRadians;
  const lat1 = a[1] * toRadians;
  const lon2 = b[0] * toRadians;
  const lat2 = b[1] * toRadians;

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return 6371000 * c;
}

function coordinatesBounds(lines) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const line of lines) {
    for (const point of line) {
      const lng = point[0];
      const lat = point[1];

      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
    }
  }

  if (!Number.isFinite(minLat)) {
    return null;
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

function boundsCenter(bounds) {
  const minLat = bounds[0][0];
  const minLng = bounds[0][1];
  const maxLat = bounds[1][0];
  const maxLng = bounds[1][1];

  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

function showGameEndPanel() {
  if (!state.puzzle) {
    return;
  }

  // Set OSMP trails link (only for trail mode with valid trlId)
  const trlId = state.puzzle.trlId;
  if (state.gameMode === "trail" && trlId && /^\d+$/.test(trlId)) {
    const osmpUrl = `https://experience.arcgis.com/experience/453953e79ff64148821c1187c8ab3edc/page/Trails#data_s=where:dataSource_5-19745beeebf-layer-12:TRLID=${trlId}&zoom_to_selection=true`;
    dom.osmpLink.href = osmpUrl;
    dom.osmpLink.parentElement.hidden = false;
  } else {
    dom.osmpLink.parentElement.hidden = true;
  }

  // Show panel
  dom.gameEndPanel.hidden = false;

  // Calculate initial score (trivia bonus will be added later if applicable)
  calculateScore();
  displayScore();

  // Show trivia panel (only for trail mode)
  if (state.gameMode === "trail") {
    // Trivia data was pre-fetched at init; if missing, try once more
    const triviaReady = state.managementAreas.length || state.wildlifeClosures.length;
    if (!triviaReady) {
      fetchTriviaData().then(() => {
        showTriviaPanel();
      }).catch((error) => {
        console.warn("Failed to load trivia data:", error);
        showTriviaPanel(); // show anyway with what we have
      });
    } else {
      showTriviaPanel();
    }
  }
}

function showTriviaPanel() {
  if (state.gameMode !== "trail" || !state.puzzle) {
    return;
  }

  state.triviaScore = 0;
  dom.triviaQuestions.innerHTML = "";

  // Get trail data for trivia
  const trail = state.puzzle;
  
  // Use dogReg stored directly on the catalog entry
  const dogReg = trail.dogReg || "Unknown";

  // Prepare trivia questions
  const questions = [
    {
      question: "What is the dog regulation on this trail?",
      correctAnswer: dogReg,
      options: generateDogRegOptions(dogReg),
    },
    {
      question: "What management area designation is closest to this trail?",
      correctAnswer: findClosestManagementArea(),
      options: generateManagementAreaOptions(),
    },
    {
      question: "What is the closest trailhead to this trail?",
      correctAnswer: findClosestTrailhead(trail.center)?.name || "Unknown",
      options: generateTrailheadOptions(),
    },
    {
      question: "Is there a wildlife closure within 500ft of this trail? If so, what species?",
      correctAnswer: findNearbyWildlifeClosure(),
      options: ["Bat", "Raptor", "Grassland Bird", "No nearby closure"],
    },
  ];

  // Render questions one at a time
  let currentQuestion = 0;
  
  function renderQuestion(index) {
    if (index >= questions.length) {
      // All questions answered, show final score
      dom.triviaScoreDisplay.textContent = `Trivia Score: ${state.triviaScore}/${questions.length}`;
      dom.triviaScoreDisplay.hidden = false;
      
      // Recalculate total score with trivia bonus and update display
      calculateScore();
      displayScore();
      
      return;
    }

    const q = questions[index];
    const questionDiv = document.createElement("div");
    questionDiv.className = "trivia-question";

    const questionText = document.createElement("p");
    questionText.textContent = `${index + 1}. ${q.question}`;
    questionDiv.appendChild(questionText);

    const optionsDiv = document.createElement("div");
    optionsDiv.className = "trivia-options";

    for (const option of q.options) {
      const button = document.createElement("button");
      button.className = "trivia-option";
      button.textContent = option;
      button.addEventListener("click", () => {
        const correct = option === q.correctAnswer;
        if (correct) {
          button.classList.add("correct");
          state.triviaScore += 1;
        } else {
          button.classList.add("incorrect");
          // Highlight the correct answer
          for (const btn of optionsDiv.querySelectorAll(".trivia-option")) {
            if (btn.textContent === q.correctAnswer) {
              btn.classList.add("correct");
            }
          }
        }

        // Disable all buttons
        for (const btn of optionsDiv.querySelectorAll(".trivia-option")) {
          btn.disabled = true;
        }

        // Show next question after a delay
        setTimeout(() => {
          renderQuestion(index + 1);
        }, 1000);
      });
      optionsDiv.appendChild(button);
    }

    questionDiv.appendChild(optionsDiv);
    dom.triviaQuestions.appendChild(questionDiv);
  }

  dom.triviaPanel.hidden = false;
  renderQuestion(0);
}

function generateDogRegOptions(correctAnswer) {
  const allOptions = [
    "Leash Required",
    "No Dogs",
    "Leash, Voice and Sight Control",
    "Regulation Varies",
    "No Dogs Allowed",
    "Leash, or Voice & Sight Control",
  ];

  // Always include the correct answer
  const options = [correctAnswer];
  
  // Add 3 random wrong answers
  const seed = hashString(state.puzzle.normalizedName + "-dogReg");
  const rng = createSeededRandom(seed);
  
  const shuffled = allOptions.filter((opt) => opt !== correctAnswer).sort(() => rng() - 0.5);
  for (let i = 0; i < 3 && i < shuffled.length; i++) {
    options.push(shuffled[i]);
  }

  // Shuffle final options
  return options.sort(() => rng() - 0.5);
}

function findClosestManagementArea() {
  if (!state.managementAreas.length || !state.puzzle.center) {
    return "Unknown";
  }

  let closest = null;
  let minDistance = Infinity;

  for (const area of state.managementAreas) {
    const distance = haversineMeters(state.puzzle.center, area.centroid);
    if (distance < minDistance) {
      minDistance = distance;
      closest = area;
    }
  }

  return closest?.name || "Unknown";
}

function generateManagementAreaOptions() {
  const correctAnswer = findClosestManagementArea();
  const allAreas = state.managementAreas.map((a) => a.name);

  if (allAreas.length === 0) {
    return [correctAnswer, "Area A", "Area B", "Area C"];
  }

  const options = [correctAnswer];
  const seed = hashString(state.puzzle.normalizedName + "-mgmt");
  const rng = createSeededRandom(seed);

  const others = allAreas.filter((name) => name !== correctAnswer).sort(() => rng() - 0.5);
  for (let i = 0; i < 3 && i < others.length; i++) {
    options.push(others[i]);
  }

  // If not enough options, add placeholders
  while (options.length < 4) {
    options.push(`Area ${options.length}`);
  }

  return options.sort(() => rng() - 0.5);
}

function generateTrailheadOptions() {
  const closestTrailhead = findClosestTrailhead(state.puzzle.center);
  const correctAnswer = closestTrailhead?.name || "Unknown";

  if (!state.trailheads.length) {
    return [correctAnswer, "Trailhead A", "Trailhead B", "Trailhead C"];
  }

  const options = [correctAnswer];
  const seed = hashString(state.puzzle.normalizedName + "-trailhead");
  const rng = createSeededRandom(seed);

  const others = state.trailheads
    .filter((th) => th.name !== correctAnswer)
    .sort(() => rng() - 0.5);

  for (let i = 0; i < 3 && i < others.length; i++) {
    options.push(others[i].name);
  }

  // If not enough options, add placeholders
  while (options.length < 4) {
    options.push(`Trailhead ${options.length}`);
  }

  return options.sort(() => rng() - 0.5);
}

function findNearbyWildlifeClosure() {
  if (!state.wildlifeClosures.length || !state.puzzle.center) {
    return "No nearby closure";
  }

  const maxDistance = 150; // ~500 feet in meters

  for (const closure of state.wildlifeClosures) {
    const distance = haversineMeters(state.puzzle.center, closure.centroid);
    if (distance <= maxDistance) {
      return closure.species || "Unknown Species";
    }
  }

  return "No nearby closure";
}

function shareScore() {
  if (!state.puzzle) {
    return;
  }

  const dateKey = dom.dateKey.textContent;
  const difficulty = DIFFICULTY[state.difficulty];
  const difficultyEmojis = {
    "young-to-hike": "🌱",
    "not-too-steep": "🥾",
    "hike-me-plenty": "⛰️",
    "ultra-vertical": "🧗",
    "nighthike": "🌙",
  };
  const difficultyEmoji = difficultyEmojis[state.difficulty] || "⛰️";
  const modeEmoji = state.gameMode === "property" ? "🏞️" : "🥾";

  // Build guess emoji grid
  const guessEmojis = state.guesses
    .map((guess) => (guess.correct ? "🟩" : "⬛"))
    .join("");

  const scoreLines = [
    `OSMP Traille ${dateKey} ${modeEmoji} ${difficultyEmoji}`,
    guessEmojis,
    `Score: ${state.score}/1000`,
    `Trail: ${state.scoreBreakdown?.trailScore || 0}/600 | Trivia: ${state.scoreBreakdown?.triviaBonus || 0}/400`,
    `Difficulty: ${difficulty.label}`,
  ];

  const scoreText = scoreLines.join("\n");

  // Copy to clipboard
  navigator.clipboard
    .writeText(scoreText)
    .then(() => {
      // Show feedback
      dom.shareFeedback.hidden = false;
      setTimeout(() => {
        dom.shareFeedback.hidden = true;
      }, 2000);
    })
    .catch((error) => {
      console.error("Failed to copy to clipboard:", error);
      alert("Failed to copy score. Please try again.");
    });
}
