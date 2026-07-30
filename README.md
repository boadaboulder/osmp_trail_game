# OSMP Traille

Owner: sboada
Last updated: 2026-07-30
Audience: Developers iterating on the Boulder OSMP daily trail guessing game.

## Overview

OSMP Traille is a Wordle-like map game for Boulder Open Space and Mountain Parks trail data.

- A single trail is selected deterministically per UTC date.
- The selected trail is revealed in 6 progressive contiguous stages.
- The player has 6 guesses to match the trail name.
- Guesses use a type-to-filter dropdown populated with valid trail names.
- Wrong guesses provide directional hints (north/south and east/west offsets) in imperial units.

## Scope and Non-Goals

Scope in this version:

- Static frontend only (HTML, CSS, JS).
- Live fetch from the City of Boulder Open Data trail service with local snapshot fallback.
- Dissolve/group by normalized trail name and network merging on the client.
- Full-network reveal ordering with deterministic traversal.

Non-goals in this version:

- No backend or database.
- No multiplayer, accounts, leaderboards, or persistence.
- No fuzzy matching beyond normalized exact match.
- No closure-status filtering.

## Prerequisites

- A modern desktop browser.
- Network access to the Boulder Open Data-backed ArcGIS service.
- A local static server.
- Local snapshot file at data/osmp_trails.geojson for browsers that block cross-origin API calls.

Example static servers:

- Python: python3 -m http.server 8080
- VS Code Live Server extension

## Procedure

1. Open the project folder.
2. Start a static server from the project root.
3. Open index.html through that server.
4. Wait for the status text to show that the daily puzzle is ready.
5. Type in the Trail guess field and pick from the filtered dropdown suggestions.

Snapshot refresh (optional but recommended):

1. Run the command below from project root to refresh data/osmp_trails.geojson from the source API.

curl -s 'https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/TrailsNEW/MapServer/4/query?where=1%3D1&outFields=OBJECTID,TRLID,TRAILNAME,DOGREGGEN&returnGeometry=true&outSR=4326&f=geojson' -o data/osmp_trails.geojson

Gameplay rules:

1. You start with reveal stage 1 of 6 visible on the map.
2. Each wrong guess reveals the next stage.
3. You have 6 total guesses.
4. Correct guess ends the round and reveals all stages.

## GitHub Pages Deployment

This repository is configured for GitHub Pages via GitHub Actions.

Included files:

- .github/workflows/deploy-pages.yml
- .nojekyll

Procedure:

1. Create a GitHub repository and push this project.
2. Ensure your default branch is main, or update .github/workflows/deploy-pages.yml to match your default branch.
3. In GitHub repo settings, open Pages.
4. Under Build and deployment, set Source to GitHub Actions.
5. Push to main (or run the Deploy OSMP Traille to GitHub Pages workflow manually from the Actions tab).
6. Wait for workflow completion, then open the published URL shown in the deploy job.

Validation:

1. Confirm the site loads with index.html content.
2. Confirm app.js and styles.css load without 404 errors.
3. Confirm data/osmp_trails.geojson is accessible from the published site.
4. Confirm a new guess round works end to end on the deployed URL.

## Validation

Manual checks:

1. Refresh page twice on same UTC date and confirm same puzzle appears.
2. Submit a wrong guess and confirm reveal stage increments by 1.
3. Submit six wrong guesses and confirm the answer is revealed.
4. Submit the exact answer with different case and punctuation and confirm it matches.
5. Resize to mobile width and confirm layout remains readable.

## Troubleshooting

- If map tiles do not render, verify internet access and OpenStreetMap availability.
- If the game never loads in Firefox but works elsewhere, the Open Data ArcGIS service may be blocked by CORS in that browser; the app will fall back to data/osmp_trails.geojson.
- If no puzzle is generated, source data may be empty or malformed.
- If reveals look odd on highly branched trails, this is expected in v1 full-network mode.

## References or Ownership

- Canonical API page: https://open-data.bouldercolorado.gov/datasets/Boulder::osmp-trails/api
- ArcGIS trail layer: https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/TrailsNEW/MapServer/4
- Query endpoint used by app: https://gis.bouldercolorado.gov/ags_svr2/rest/services/osmp/TrailsNEW/MapServer/4/query
- Owner: sboada
