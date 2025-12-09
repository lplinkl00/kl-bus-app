# GTFS Transport React - Malaysia Bus Tracker

A React application that visualizes real-time bus positions from Malaysia's GTFS Realtime API using deck.gl's TripsLayer for animated bus movement visualization.

## Features

- 🚌 Real-time bus position tracking from Malaysia's Open API
- 🗺️ Interactive map with deck.gl and Mapbox
- 🎬 Animated bus movement with direction and speed visualization
- 🚏 Bus stops display (when GTFS static data is available)
- 🔄 Auto-refresh every 30 seconds

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Get a Mapbox Access Token

1. Sign up for a free account at [Mapbox](https://account.mapbox.com/)
2. Get your access token from the [Mapbox account page](https://account.mapbox.com/access-tokens/)
3. Create a `.env` file in the `my-react-app` directory:

```env
VITE_MAPBOX_TOKEN=your_mapbox_token_here
```

Alternatively, you can edit `src/components/BusMap.jsx` and replace the default token (though it's recommended to use your own).

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
│   │   └── gtfsStatic.ts    # GTFS Static API service
│   ├── App.tsx
│   └── main.tsx
└── package.json
```


## Notes

- The application tracks vehicle position history to create smooth animation trails
- Bus stops are fetched from GTFS Static data (may require ZIP file parsing)
- The map is centered on Kuala Lumpur by default
- Animation speed and trail length can be adjusted in `BusMap.jsx`

"Low Poly Bus" (https://skfb.ly/oVWOM) by MHKstudio is licensed under Creative Commons Attribution (http://creativecommons.org/licenses/by/4.0/).

(https://www.flaticon.com/free-icons/bus) "bus icons" Bus icons created by Freepik - Flaticon
## License

MIT
