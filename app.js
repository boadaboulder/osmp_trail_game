const STAGE_COUNT = 6;
const MAX_GUESSES = 6;

const FIELD = {
  trailId: "OSMP.TrailsOSMP.TRLID",
  trailName: "OSMP.TrailsOSMP.TRAILNAME",
  objectId: "OSMP.TrailsOSMP.OBJECTID",
};

const API_URL =
  "https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/TrailsNEW/MapServer/4/query" +
  "?where=1%3D1" +
  "&outFields=OSMP.TrailsOSMP.OBJECTID,OSMP.TrailsOSMP.TRLID,OSMP.TrailsOSMP.TRAILNAME" +
  "&returnGeometry=true" +
  "&outSR=4326" +
  "&f=geojson";

const LOCAL_DATA_URL = "./data/osmp_trails.geojson";

const state = {
  catalog: [],
  puzzle: null,
  displayNameByNormalized: new Map(),
  trailByNormalized: new Map(),
  hardMode: false,
  attemptsUsed: 0,
  revealStage: 1,
  solved: false,
  guesses: [],
};

const dom = {
  generatedDate: document.getElementById("generated-date"),
  dateKey: document.getElementById("date-key"),
  attemptsUsed: document.getElementById("attempts-used"),
  revealStage: document.getElementById("reveal-stage"),
  hardModeToggle: document.getElementById("hard-mode-toggle"),
  form: document.getElementById("guess-form"),
  input: document.getElementById("guess-input"),
  options: document.getElementById("guess-options"),
  status: document.getElementById("status"),
  hint: document.getElementById("hint"),
  history: document.getElementById("guess-history"),
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
  populateGuessOptions(catalog);

  const dateKey = getUtcDateKey();
  dom.dateKey.textContent = dateKey;
  const puzzleMode = getPuzzleMode();
  state.puzzle = selectPuzzle(catalog, dateKey, puzzleMode);

  refreshUi();
  setHint("");
  updateMapForStage(state.revealStage);

  if (puzzleMode === "longest") {
    setStatus("Test mode active: longest trail selected. Type to filter trail names, then submit your guess.", "warning");
  } else {
    setStatus("Daily puzzle ready. Type to filter trail names, then submit your guess.", "warning");
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

  dom.hardModeToggle.addEventListener("change", () => {
    state.hardMode = dom.hardModeToggle.checked;
    setHint("");
    refreshUi();
  });
}

async function fetchTrailFeatures() {
  const failures = [];

  try {
    const payload = await fetchFeaturePayload(API_URL);
    return payload.features;
  } catch (error) {
    failures.push(`remote fetch blocked or failed (${error.message})`);
  }

  try {
    const payload = await fetchFeaturePayload(LOCAL_DATA_URL);
    setStatus("Using local trail snapshot because remote fetch was unavailable.", "warning");
    return payload.features;
  } catch (error) {
    failures.push(`local snapshot unavailable (${error.message})`);
  }

  throw new Error(failures.join("; "));
}

async function fetchFeaturePayload(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`request failed with status ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.features)) {
    throw new Error("response did not contain a GeoJSON feature list");
  }

  return payload;
}

function buildTrailCatalog(features) {
  const groups = new Map();

  for (const feature of features) {
    const properties = feature.properties || {};
    const trailName = String(properties[FIELD.trailName] || "").trim();
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
      sortKey: `${trail.normalizedName}|${trail.displayName}`,
      stages,
      bounds,
      center: boundsCenter(bounds),
      totalLengthMeters: traversal.totalLength,
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

function submitGuess() {
  if (!state.puzzle || state.solved || state.attemptsUsed >= MAX_GUESSES) {
    return;
  }

  const rawGuess = dom.input.value.trim();
  const normalized = normalizeName(rawGuess);

  if (!normalized) {
    setStatus("Type and select a trail name before submitting.", "warning");
    return;
  }

  if (!state.displayNameByNormalized.has(normalized)) {
    setStatus("Pick a valid trail from the dropdown list.", "warning");
    return;
  }

  if (state.guesses.some((guess) => guess.normalized === normalized)) {
    setStatus("You already guessed that trail name.", "warning");
    return;
  }

  const guessLabel = state.displayNameByNormalized.get(normalized);
  const guessedTrail = state.trailByNormalized.get(normalized);
  const correct = normalized === state.puzzle.normalizedName;
  const hintText = !correct && !state.hardMode ? buildDirectionalHint(guessedTrail, state.puzzle) : "";
  state.guesses.push({ text: guessLabel, normalized, correct, hint: hintText });

  if (correct) {
    state.solved = true;
    state.revealStage = STAGE_COUNT;
    refreshUi();
    setHint("");
    updateMapForStage(state.revealStage);
    setStatus(`Correct. The trail is ${state.puzzle.displayName}.`, "success");
    dom.form.querySelector("button").disabled = true;
    dom.input.disabled = true;
    return;
  }

  setHint(state.hardMode ? "" : hintText);

  state.attemptsUsed += 1;

  if (state.attemptsUsed >= MAX_GUESSES) {
    state.revealStage = STAGE_COUNT;
    refreshUi();
    updateMapForStage(state.revealStage);
    setStatus(`No guesses left. The trail was ${state.puzzle.displayName}.`, "error");
    dom.form.querySelector("button").disabled = true;
    dom.input.disabled = true;
  } else {
    state.revealStage = Math.min(STAGE_COUNT, state.revealStage + 1);
    refreshUi();
    updateMapForStage(state.revealStage);
    setStatus("Not a match. Next contiguous segment is now revealed.", "warning");
  }

  dom.input.value = "";
  dom.input.focus();
}

function populateGuessOptions(catalog) {
  state.displayNameByNormalized = new Map();
  state.trailByNormalized = new Map();

  const options = [...catalog].sort((a, b) => a.displayName.localeCompare(b.displayName));

  dom.options.innerHTML = "";

  for (const trail of options) {
    const normalized = trail.normalizedName;
    const displayName = trail.displayName;
    if (!normalized || state.displayNameByNormalized.has(normalized)) {
      continue;
    }

    state.displayNameByNormalized.set(normalized, displayName);
    state.trailByNormalized.set(normalized, trail);

    const option = document.createElement("option");
    option.value = displayName;
    dom.options.appendChild(option);
  }

  dom.input.value = "";
  dom.input.placeholder = "Type to filter trail names";
  dom.input.disabled = false;
  dom.form.querySelector("button").disabled = false;
}

function updateMapForStage(stageNumber) {
  if (!state.puzzle) {
    return;
  }

  const clampedStage = Math.max(1, Math.min(stageNumber, STAGE_COUNT));
  const stage = state.puzzle.stages[clampedStage - 1];

  revealLayer.clearLayers();

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
    map.fitBounds(fullBounds, {
      padding: [24, 24],
      animate: false,
    });
  }
}

function refreshUi() {
  dom.attemptsUsed.textContent = String(state.attemptsUsed);
  dom.revealStage.textContent = String(state.revealStage);

  dom.history.innerHTML = "";
  for (const guess of state.guesses) {
    const item = document.createElement("li");
    if (guess.correct || state.hardMode || !guess.hint) {
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
  if (!fromTrail || !targetTrail || !fromTrail.center || !targetTrail.center) {
    return "Hint unavailable for this guess.";
  }

  const fromLon = fromTrail.center[0];
  const fromLat = fromTrail.center[1];
  const targetLon = targetTrail.center[0];
  const targetLat = targetTrail.center[1];

  const averageLatRadians = ((fromLat + targetLat) / 2) * (Math.PI / 180);
  const northSouthMiles = (targetLat - fromLat) * 69.172;
  const eastWestMiles = (targetLon - fromLon) * 69.172 * Math.cos(averageLatRadians);

  const nsDirection = northSouthMiles >= 0 ? "north" : "south";
  const ewDirection = eastWestMiles >= 0 ? "east" : "west";
  const nsDistance = formatImperialDistance(Math.abs(northSouthMiles));
  const ewDistance = formatImperialDistance(Math.abs(eastWestMiles));

  return `Hint: target is ${nsDistance} ${nsDirection} and ${ewDistance} ${ewDirection} of ${fromTrail.displayName}.`;
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
