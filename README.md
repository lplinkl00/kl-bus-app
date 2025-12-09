# GTFS Transport React - Malaysia Bus Tracker

A React application that visualizes real-time bus positions from Malaysia's GTFS Realtime API using deck.gl's TripsLayer for animated bus movement visualization.

## Features

- 🚌 Real-time bus position tracking from Malaysia's Open API
- 🗺️ Interactive map with deck.gl and Mapbox
- 🎬 Animated bus movement with direction and speed visualization
- 🚏 Bus stops display (when GTFS static data is available)
- 🛣️ Road-following bus routes using Google Directions API (with session caching)
- 🔄 Auto-refresh every 45 seconds

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Get API Keys

#### Mapbox Access Token

1. Sign up for a free account at [Mapbox](https://account.mapbox.com/)
2. Get your access token from the [Mapbox account page](https://account.mapbox.com/access-tokens/)

#### Google Directions API Key (Optional but Recommended)

The app uses Google Directions API to compute road-following bus routes instead of straight lines. This provides more accurate route visualization.

1. Sign up for a [Google Cloud Platform](https://console.cloud.google.com/) account
2. Create a new project or select an existing one
3. Enable the [Directions API](https://console.cloud.google.com/apis/library/directions-backend.googleapis.com)
4. Create an API key in the [Credentials page](https://console.cloud.google.com/apis/credentials)
5. (Optional) Restrict the API key to only the Directions API for security

**Note:** Without a Google Directions API key, routes will fall back to straight lines between stops. The app will still work, but routes won't follow roads.

#### Environment Variables

Create a `.env` file in the project root directory:

```env
VITE_MAPBOX_TOKEN=your_mapbox_token_here
VITE_GOOGLE_ROUTES_API_KEY=your_google_directions_api_key_here
# OR use the alternative name:
# VITE_GOOGLE_MAPS_API_KEY=your_google_directions_api_key_here
```

**Note:** Routes are cached in session storage, so they're only computed once per browser session. This reduces API calls and improves performance.

### 3. Run the Application

```bash
npm run dev
```

The application will open at `http://localhost:5173`

## Configuration

### Adding More Bus Agencies

Edit `src/components/BusMap.jsx` and modify the `agencies` array:

```javascript
const agencies = useMemo(() => [
  { agency: 'prasarana', category: 'rapid-bus-kl' },
  { agency: 'prasarana', category: 'rapid-bus-mrtfeeder' },
  { agency: 'prasarana', category: 'rapid-bus-kuantan' },
  { agency: 'prasarana', category: 'rapid-bus-penang' },
  { agency: 'mybas-kangar' },
  { agency: 'mybas-alor-setar' },
  // ... more agencies
], []);
```

### Available Agencies

Based on the [Malaysia Open API documentation](https://developer.data.gov.my/realtime-api/gtfs-realtime):

**Prasarana:**
- `rapid-bus-kl` - RapidKL buses in Kuala Lumpur
- `rapid-bus-mrtfeeder` - MRT feeder buses
- `rapid-bus-kuantan` - Kuantan buses
- `rapid-bus-penang` - Penang buses

**BAS.MY:**
- `mybas-kangar`
- `mybas-alor-setar`
- `mybas-kota-bharu`
- `mybas-kuala-terengganu`
- `mybas-ipoh`
- `mybas-seremban-a` and `mybas-seremban-b`
- `mybas-melaka`
- `mybas-johor`
- `mybas-kuching`

**KTMB:**
- `ktmb` - Train services

## API Information

- **GTFS Realtime API**: Updates every 30 seconds
- **Documentation**: https://developer.data.gov.my/realtime-api/gtfs-realtime
- **GTFS Static API**: https://developer.data.gov.my/realtime-api/gtfs-static

## Technologies Used

- React 19
- Vite
- deck.gl - WebGL-powered visualization framework
- react-map-gl - React wrapper for Mapbox GL
- Mapbox GL - Map rendering
- gtfs-realtime-bindings - Protocol Buffer parsing for GTFS Realtime

## Project Structure

```
bus-trips/
├── src/
│   ├── components/
│   │   └── BusMap.tsx       # Main map component
│   ├── services/
│   │   ├── gtfsRealtime.ts  # GTFS Realtime API service
│   │   ├── gtfsStatic.ts    # GTFS Static API service
│   │   └── googleRoutes.ts  # Google Directions API service for road-following routes
│   ├── App.tsx
│   └── main.tsx
└── package.json
```


## Notes

- The application tracks vehicle position history to create smooth animation trails
- Bus stops are fetched from GTFS Static data (may require ZIP file parsing)
- The map is centered on Kuala Lumpur by default
- Animation speed and trail length can be adjusted in `BusMap.tsx`
- **Route Caching**: Bus routes are computed using Google Directions API and cached in session storage. Routes are only recalculated when:
  - The browser session is cleared
  - The cache is manually cleared
  - Routes are not found in the cache
- **Rate Limiting**: The app implements rate limiting for Google Directions API calls (40 requests/second) to avoid exceeding API quotas

"Low Poly Bus" (https://skfb.ly/oVWOM) by MHKstudio is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

(https://www.flaticon.com/free-icons/bus) "bus icons" Bus icons created by Freepik - Flaticon
## License

MIT
