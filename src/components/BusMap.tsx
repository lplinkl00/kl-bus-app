import { useState, useEffect, useCallback, useMemo } from 'react';
import MapGL from 'react-map-gl/mapbox';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, IconLayer } from '@deck.gl/layers';
// import { ScenegraphLayer } from '@deck.gl/mesh-layers';
import type { PickingInfo } from '@deck.gl/core';

import { fetchMultipleAgencies } from '../services/gtfsRealtime';
import { fetchMultipleAgencyStops, fetchMultipleAgencyRoutes, getStopColor as getStopColorFromService } from '../services/gtfsStatic';

import 'mapbox-gl/dist/mapbox-gl.css';

// Type definitions
interface Vehicle {
  id: string;
  tripId: string | null;
  routeId: string | null;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
  timestamp: number;
}

interface Stop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  code?: string;
  routeId?: string | null; // Route ID from stops.txt (for train stations)
}

interface Route {
  id: string;
  path: [number, number][];
  timestamps: number[];
  routeId: string | null;
}

interface BusPosition {
  id: string;
  longitude: number;
  latitude: number;
  bearing: number;
  speed: number;
  routeId: string | null;
  tripId: string | null;
}

interface VehiclePosition {
  longitude: number;
  latitude: number;
  timestamp: number;
  bearing: number;
  speed: number;
}

interface Agency {
  agency: string;
  category?: string;
}

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

// Preserve native Map constructor to avoid shadowing from imports
const NativeMap = window.Map;

// Mapbox token - loaded from environment variables
// Set VITE_MAPBOX_TOKEN in your .env file
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

// Default viewport for Malaysia (Kuala Lumpur area)
const INITIAL_VIEW_STATE: ViewState = {
  longitude: 101.6869,
  latitude: 3.1390,
  zoom: 11,
  pitch: 45,
  bearing: 0,
};

// Update interval in milliseconds (API updates every 30 seconds)
const UPDATE_INTERVAL = 45000;

export default function BusMap() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [, setVehicleHistory] = useState<Map<string, VehiclePosition[]>>(new NativeMap());
  const [stops, setStops] = useState<Stop[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const [selectedBus, setSelectedBus] = useState<BusPosition | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showSearchResults, setShowSearchResults] = useState<boolean>(false);
  const [loadingRealtime, setLoadingRealtime] = useState<boolean>(true);
  const [loadingStatic, setLoadingStatic] = useState<boolean>(true);
  const [viewState, setViewState] = useState<ViewState>(INITIAL_VIEW_STATE);
  const [glError, setGlError] = useState<string | null>(null);
  // const [busModel, setBusModel] = useState<any>(null); // GLTF model type from loaders.gl - COMMENTED OUT: Using 2D icons
  
  // Combined loading state - map only shows when both are ready
  const isLoading = loadingRealtime || loadingStatic;
  
  // Load the bus 3D model - COMMENTED OUT: Using 2D icons instead
  // useEffect(() => {
  //   const loadBusModel = async () => {
  //     try {
  //       // Dynamically import loaders to avoid breaking the component if they fail
  //       const { load } = await import('@loaders.gl/core');
  //       const { GLTFLoader } = await import('@loaders.gl/gltf');
  //       
  //       // Use import.meta.url to get the correct path in Vite
  //       // The GLTFLoader will automatically load the referenced scene.bin file
  //       const modelUrl = new URL('../assets/scene.gltf', import.meta.url).href;
  //       const model = await load(modelUrl, GLTFLoader, {
  //         // GLTFLoader options - it will automatically resolve scene.bin relative to scene.gltf
  //         gltf: {
  //           loadBuffers: true, // Ensure binary buffers are loaded
  //           loadImages: false, // No images in this model
  //         }
  //       });
  //       if (model) {
  //         // GLTFLoader returns the parsed model, extract the scene
  //         // Type assertion for GLTF model structure
  //         const gltfModel = model as any;
  //         const scene = (gltfModel.scenes && gltfModel.scenes[0]) || gltfModel;
  //         setBusModel(scene);
  //         console.log('Bus 3D model loaded successfully with binary data');
  //       }
  //     } catch (error) {
  //       console.warn('Could not load 3D bus model, using fallback markers:', error);
  //       console.warn('To use 3D models, install: npm install @loaders.gl/core @loaders.gl/gltf');
  //       // Continue without 3D model - will use scatterplot fallback
  //       setBusModel(null);
  //     }
  //   };
  //   loadBusModel();
  // }, []);

  // Load bus icon from assets
  const [busIconAtlas, setBusIconAtlas] = useState<string | null>(null);
  const [busIconSize, setBusIconSize] = useState<{ width: number; height: number } | null>(null);
  
  useEffect(() => {
    // Load the bus.png image from assets
    const loadBusIcon = async () => {
      try {
        // Use import.meta.url to get the correct path in Vite
        const iconUrl = new URL('../assets/bus.png', import.meta.url).href;
        
        // Create an image element to load the icon
        const img = new Image();
        img.crossOrigin = 'anonymous';
        
        img.onload = () => {
          // Create a canvas to convert the image to a data URL
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const dataUrl = canvas.toDataURL();
            setBusIconAtlas(dataUrl);
            setBusIconSize({ width: img.width, height: img.height });
          }
        };
        
        img.onerror = () => {
          console.warn('Failed to load bus icon from assets/bus.png');
        };
        
        img.src = iconUrl;
      } catch (error) {
        console.warn('Error loading bus icon:', error);
      }
    };
    
    loadBusIcon();
  }, []);

  // Define which agencies to fetch data from
  const agencies = useMemo<Agency[]>(() => [
    { agency: 'prasarana', category: 'rapid-bus-kl' },
    // Add more agencies as needed:
    // { agency: 'prasarana', category: 'rapid-bus-mrtfeeder' },
    // { agency: 'mybas-kangar' },
  ], []);

  // Fetch vehicle positions
  const fetchVehicles = useCallback(async () => {
    try {
      const data = await fetchMultipleAgencies(agencies);
      const currentTime = Date.now() / 1000;
      
      // Update vehicle history
      setVehicleHistory(prev => {
        const newHistory = new NativeMap(prev);
        
        data.forEach(vehicle => {
          const vehicleId = vehicle.id;
          if (!newHistory.has(vehicleId)) {
            newHistory.set(vehicleId, []);
          }
          
          const history = newHistory.get(vehicleId)!;
          const newPosition: VehiclePosition = {
            longitude: vehicle.longitude,
            latitude: vehicle.latitude,
            timestamp: vehicle.timestamp || currentTime,
            bearing: vehicle.bearing,
            speed: vehicle.speed,
          };
          
          // Add new position
          history.push(newPosition);
          
          // Keep only last 60 seconds of history (assuming 30s updates, keep ~2-3 points)
          const cutoffTime = currentTime - 60;
          const filtered = history.filter(pos => pos.timestamp >= cutoffTime);
          newHistory.set(vehicleId, filtered);
        });
        
        return newHistory;
      });
      
      setVehicles(data);
      setLoadingRealtime(false);
    } catch (error) {
      console.error('Error fetching vehicles:', error);
      // Check for 429 rate limit errors
      if (error instanceof Error && error.message?.includes('429')) {
        console.warn('Rate limit exceeded (429). Consider increasing UPDATE_INTERVAL if this persists.');
      }
      setLoadingRealtime(false);
    }
  }, [agencies]);

  // Fetch stops (only once on mount)
  const fetchStopsData = useCallback(async () => {
    try {
      const stopsData = await fetchMultipleAgencyStops(agencies);
      console.log('Fetched stops:', stopsData.length);
      setStops(stopsData);
    } catch (error) {
      console.error('Error fetching stops:', error);
    }
  }, [agencies]);
  
  // Fetch route paths (only once on mount)
  const fetchRoutesData = useCallback(async () => {
    try {
      const routesData = await fetchMultipleAgencyRoutes(agencies);
      setRoutes(routesData);
    } catch (error) {
      console.error('Error fetching routes:', error);
      // Set empty array on error so loading can complete
      setRoutes([]);
    }
  }, [agencies]);
  
  // Track when static data (stops + routes) is ready
  useEffect(() => {
    // Static data is ready when we've attempted to fetch both stops and routes
    // We check this by seeing if routes have been set (even if empty)
    // This ensures both fetch operations have completed
    if (routes.length >= 0 && stops.length >= 0) {
      // Small delay to ensure both fetches have completed
      const timer = setTimeout(() => {
        setLoadingStatic(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [routes.length, stops.length]);

  // Initial data fetch
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    
    // Initial fetch
    fetchVehicles();
    fetchStopsData();
    fetchRoutesData();
    
    // Set up polling for vehicle positions
    // Use a wrapper function to ensure fetchVehicles is called correctly
    intervalId = setInterval(() => {
      fetchVehicles();
    }, UPDATE_INTERVAL);
    
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array - only run once on mount to prevent multiple intervals

  // Convert vehicles to simple position data for bus markers
  // Just show current bus positions, no paths
  const busPositions = useMemo<BusPosition[]>(() => {
    return vehicles.map(vehicle => ({
      id: vehicle.id,
      longitude: vehicle.longitude,
      latitude: vehicle.latitude,
      bearing: vehicle.bearing || 0,
      speed: vehicle.speed || 0,
      routeId: vehicle.routeId,
      tripId: vehicle.tripId,
    }));
  }, [vehicles]);

  // Filter bus positions to only include those with valid coordinates
  const validBusPositions = useMemo<BusPosition[]>(() => {
    return busPositions.filter(bus => 
      bus && 
      typeof bus.latitude === 'number' && 
      !isNaN(bus.latitude) &&
      typeof bus.longitude === 'number' && 
      !isNaN(bus.longitude) &&
      bus.latitude !== 0 && 
      bus.longitude !== 0 &&
      typeof bus.bearing === 'number' && 
      !isNaN(bus.bearing)
    );
  }, [busPositions]);

  // Filter buses based on search query (using valid bus positions)
  const filteredBuses = useMemo<BusPosition[]>(() => {
    if (!searchQuery.trim()) {
      return validBusPositions;
    }
    const query = searchQuery.toLowerCase().trim();
    return validBusPositions.filter(bus => 
      bus.id.toLowerCase().includes(query) ||
      (bus.routeId && bus.routeId.toLowerCase().includes(query)) ||
      (bus.tripId && bus.tripId.toLowerCase().includes(query))
    );
  }, [validBusPositions, searchQuery]);

  // Highlight searched bus
  const highlightedBusId = useMemo<string | null>(() => {
    if (!searchQuery.trim() || filteredBuses.length !== 1) {
      return null;
    }
    return filteredBuses[0].id;
  }, [searchQuery, filteredBuses]);

  // Calculate distance between two coordinates (Haversine formula)
  const calculateDistance = useCallback((lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
  }, []);

  // Find next stop for a bus based on its position and route
  const findNextStop = useCallback((bus: BusPosition): Stop | null => {
    if (!bus.tripId) return null;

    // Find the route for this bus's trip
    const route = routes.find(r => r.id === bus.tripId);
    if (!route || !route.path || route.path.length === 0) return null;

    // Find the closest point on the route path to the bus's current position
    let closestIndex = 0;
    let minDistance = Infinity;

    route.path.forEach((point, index) => {
      const distance = calculateDistance(
        bus.latitude,
        bus.longitude,
        point[1], // latitude
        point[0]  // longitude
      );
      if (distance < minDistance) {
        minDistance = distance;
        closestIndex = index;
      }
    });

    // Find the next stop after the closest point
    // Look for stops that match the route path coordinates
    const nextPathIndex = closestIndex + 1;
    if (nextPathIndex >= route.path.length) return null;

    const nextPathPoint = route.path[nextPathIndex];
    const nextStop = stops.find(stop => {
      const distance = calculateDistance(
        stop.latitude,
        stop.longitude,
        nextPathPoint[1],
        nextPathPoint[0]
      );
      return distance < 50; // Within 50 meters
    });

    return nextStop || null;
  }, [routes, stops, calculateDistance]);

  // Handle stop click
  const handleStopClick = useCallback((info: PickingInfo) => {
    if (info.object) {
      setSelectedStop(info.object as Stop);
      setSelectedBus(null); // Close bus popup when clicking stop
    }
  }, []);

  // Detect if device is mobile
  const isMobile = useMemo(() => {
    return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
           (window.innerWidth <= 768);
  }, []);

  // Handle bus click/tap
  const handleBusClick = useCallback((info: PickingInfo) => {
    if (info.object) {
      setSelectedBus(info.object as BusPosition);
      setSelectedStop(null); // Close stop popup when clicking bus
    }
  }, []);

  // Filter stops to only include those with valid coordinates
  const validStops = useMemo<Stop[]>(() => {
    return stops.filter(stop => 
      stop && 
      typeof stop.latitude === 'number' && 
      !isNaN(stop.latitude) &&
      typeof stop.longitude === 'number' && 
      !isNaN(stop.longitude) &&
      stop.latitude !== 0 && 
      stop.longitude !== 0
    );
  }, [stops]);

  // Get the color for a stop based on its route_id from the service
  const getStopColor = useCallback((stop: Stop): [number, number, number, number] => {
    // Check if selected (yellow)
    if (selectedStop && selectedStop.id === stop.id) {
      return [255, 200, 0, 255]; // Yellow for selected stop
    }
    
    // Get color from service based on route_id in stops.txt
    const trainColor = getStopColorFromService(stop);
    if (trainColor) {
      return trainColor; // Return train station color
    }
    
    // Default blue for regular bus stops
    return [0, 128, 255, 255];
  }, [selectedStop]);

  // Layers configuration
  // Order matters: stops should be on top so they're visible and clickable
  // Only create layers if we have valid data to prevent WebGL errors
  const layers = useMemo(() => {
    const layerList = [];
    
    // Route paths layer (static routes) - hidden/invisible
    // Routes are kept in the data structure but not rendered
    // if (routes && routes.length > 0) {
    //   layerList.push(
    //     new PathLayer({
    //       id: 'routes-layer',
    //       data: routes,
    //       getPath: d => d.path,
    //       getColor: [100, 100, 100, 100], // Gray, semi-transparent
    //       widthMinPixels: 2,
    //       widthMaxPixels: 4,
    //       capRounded: true,
    //       jointRounded: true,
    //     })
    //   );
    // }
    
    // Bus positions layer - shows 2D bus icons
    // Use filteredBuses if search is active, otherwise show all valid buses
    const busesToShow = searchQuery.trim() ? filteredBuses : validBusPositions;
    if (busesToShow && busesToShow.length > 0) {
      // COMMENTED OUT: 3D GLTF model with ScenegraphLayer
      // if (busModel) {
      //   // Use 3D GLTF model with ScenegraphLayer
      //   layerList.push(
      //     new ScenegraphLayer<BusPosition>({
      //       id: 'buses-layer',
      //       data: busesToShow,
      //       scenegraph: busModel,
      //       getPosition: d => [d.longitude, d.latitude],
      //       getOrientation: d => [0, -d.bearing || 0, 90], // [pitch, yaw, roll] - yaw uses bearing, roll 90 to orient model correctly
      //       getScale: () => [15, 15, 15] as [number, number, number], // Scale factor - adjust based on model size (meters)
      //       sizeScale: 1,
      //       _animations: {
      //         '*': {
      //           speed: 1
      //         }
      //       },
      //       pickable: true,
      //       autoHighlight: true, // Highlight on hover/touch
      //       highlightColor: [255, 200, 0, 200], // Yellow highlight
      //       onClick: handleBusClick,
      //       onHover: (_info: PickingInfo) => {
      //         // Optional: could add hover effects here
      //       },
      //     })
      //   );
      // } else {
      
      // Use 2D bus icons with IconLayer
      if (busIconAtlas && busIconSize) {
        layerList.push(
          new IconLayer<BusPosition>({
            id: 'buses-layer',
            data: busesToShow,
            iconAtlas: busIconAtlas,
            iconMapping: {
              marker: {
                x: 0,
                y: 0,
                width: busIconSize.width,
                height: busIconSize.height,
                anchorY: busIconSize.height / 2, // Anchor point at center for proper rotation
                anchorX: busIconSize.width / 2,
              }
            },
            getIcon: () => 'marker',
            getPosition: d => [d.longitude, d.latitude],
            getAngle: d => -d.bearing || 0, // Rotate icon based on bearing
            getSize: () => isMobile ? 32 : 28, // Icon size in pixels
            getColor: d => 
              highlightedBusId && d.id === highlightedBusId
                ? [255, 200, 0, 255] // Yellow tint for highlighted/searched bus
                : [255, 255, 255, 255], // White (no tint, use original icon colors)
            sizeScale: 1,
            sizeMinPixels: isMobile ? 24 : 20,
            sizeMaxPixels: isMobile ? 40 : 36,
            pickable: true,
            autoHighlight: true, // Highlight on hover/touch
            highlightColor: [255, 200, 0, 200], // Yellow highlight
            onClick: handleBusClick,
            onHover: (_info: PickingInfo) => {
              // Optional: could add hover effects here
            },
          })
        );
      } else {
        // Fallback to scatterplot markers if icon not loaded
        layerList.push(
          new ScatterplotLayer<BusPosition>({
            id: 'buses-layer',
            data: busesToShow,
            getPosition: d => [d.longitude, d.latitude],
            getRadius: 150, // Bus marker size
            getFillColor: d => 
              highlightedBusId && d.id === highlightedBusId
                ? [255, 200, 0, 255] // Yellow for highlighted/searched bus
                : [253, 128, 93, 255], // Orange color for buses
            getLineColor: [255, 255, 255, 255], // White outline
            getLineWidth: 2,
            radiusMinPixels: isMobile ? 12 : 8, // Larger touch target on mobile
            radiusMaxPixels: isMobile ? 24 : 16, // Larger touch target on mobile
            stroked: true,
            pickable: true,
            autoHighlight: true, // Highlight on hover/touch
            highlightColor: [255, 200, 0, 200], // Yellow highlight
            onClick: handleBusClick,
            onHover: (_info: PickingInfo) => {
              // Optional: could add hover effects here
            },
          })
        );
      }
    }
    
    // Stops layer - on top for visibility and interaction
    if (validStops && validStops.length > 0) {
      layerList.push(
        new ScatterplotLayer<Stop>({
          id: 'stops-layer',
          data: validStops,
          getPosition: d => [d.longitude, d.latitude],
          getRadius: 75, // Increased from 50 to make more visible
          getFillColor: d => getStopColor(d),
          getLineColor: [255, 255, 255, 255], // White outline
          getLineWidth: 2,
          radiusMinPixels: 6, // Increased from 4
          radiusMaxPixels: 12, // Increased from 8
          stroked: true, // Add stroke/outline
          pickable: true,
          onClick: handleStopClick,
          onHover: (_info: PickingInfo) => {
            // Optional: could add hover effects here
          },
        })
      );
    }
    
    return layerList;
  }, [routes, validBusPositions, validStops, selectedStop, handleStopClick, handleBusClick, busIconAtlas, isMobile, searchQuery, filteredBuses, highlightedBusId, getStopColor]);

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-search-container]')) {
        setShowSearchResults(false);
      }
    };
    
    if (showSearchResults) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showSearchResults]);

  // Loading screen - show until both realtime and static data are ready
  if (isLoading) {
    return (
      <div style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        color: 'white',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{
          textAlign: 'center',
          padding: '40px',
          background: 'rgba(255, 255, 255, 0.1)',
          borderRadius: '20px',
          backdropFilter: 'blur(10px)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)',
          maxWidth: '500px',
        }}>
          <div style={{
            fontSize: '48px',
            marginBottom: '20px',
            animation: 'spin 1s linear infinite',
          }}>
            🚌
          </div>
          <h1 style={{ margin: '0 0 10px 0', fontSize: '28px', fontWeight: '600' }}>
            Loading Bus Map
          </h1>
          <p style={{ margin: '0 0 30px 0', opacity: 0.9, fontSize: '16px' }}>
            Preparing your transit data...
          </p>
          
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '15px',
            width: '100%',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: loadingRealtime ? '#ffd700' : '#4ade80',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
              }}>
                {loadingRealtime ? '⏳' : '✓'}
              </div>
              <span style={{ flex: 1, textAlign: 'left' }}>
                {loadingRealtime ? 'Loading real-time vehicle positions...' : 'Real-time data ready'}
              </span>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '20px',
                height: '20px',
                borderRadius: '50%',
                background: loadingStatic ? '#ffd700' : '#4ade80',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
              }}>
                {loadingStatic ? '⏳' : '✓'}
              </div>
              <span style={{ flex: 1, textAlign: 'left' }}>
                {loadingStatic ? 'Loading routes and stops...' : 'Static data ready'}
              </span>
            </div>
          </div>
          
          {(loadingRealtime || loadingStatic) && (
            <div style={{
              marginTop: '30px',
              width: '100%',
              height: '4px',
              background: 'rgba(255, 255, 255, 0.2)',
              borderRadius: '2px',
              overflow: 'hidden',
            }}>
              <div style={{
                height: '100%',
                background: 'white',
                width: loadingRealtime && loadingStatic ? '50%' : loadingRealtime || loadingStatic ? '75%' : '100%',
                transition: 'width 0.3s ease',
                borderRadius: '2px',
              }} />
            </div>
          )}
          
          <div style={{
            marginTop: '30px',
            padding: '12px',
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '8px',
            fontSize: '13px',
            opacity: 0.85,
            lineHeight: '1.5',
          }}>
            <strong>ℹ️ Note:</strong> Bus positions are updated every 45 seconds.
          </div>
        </div>
        
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!MAPBOX_TOKEN || MAPBOX_TOKEN.includes('your')) {
    return (
      <div style={{ 
        width: '100vw', 
        height: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '20px',
        padding: '20px'
      }}>
        <h2>Mapbox Token Required</h2>
        <p>Please set your Mapbox access token in the <code>.env</code> file:</p>
        <code style={{ background: '#f0f0f0', padding: '10px', borderRadius: '5px' }}>
          VITE_MAPBOX_TOKEN=your_token_here
        </code>
        <p>
          <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener noreferrer">
            Get your token from Mapbox
          </a>
        </p>
      </div>
    );
  }

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      {/* Search Bar */}
      <div data-search-container style={{
        position: 'absolute',
        top: isMobile ? '10px' : '20px',
        left: isMobile ? '10px' : '20px',
        right: isMobile ? '10px' : 'auto',
        width: isMobile ? 'calc(100% - 20px)' : '350px',
        zIndex: 1001,
        background: 'white',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search by bus ID, route, or trip..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowSearchResults(true);
            }}
            onFocus={() => setShowSearchResults(true)}
            style={{
              width: '100%',
              padding: isMobile ? '12px 40px 12px 12px' : '10px 40px 10px 12px',
              border: 'none',
              outline: 'none',
              fontSize: isMobile ? '16px' : '14px', // Prevent zoom on iOS
              borderRadius: '8px',
            }}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setShowSearchResults(false);
                setSelectedBus(null);
              }}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: '18px',
                color: '#666',
                padding: '4px',
                minWidth: '32px',
                minHeight: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
        
        {/* Search Results Dropdown */}
        {showSearchResults && searchQuery.trim() && filteredBuses.length > 0 && (
          <div style={{
            maxHeight: isMobile ? '200px' : '300px',
            overflowY: 'auto',
            borderTop: '1px solid #e0e0e0',
            background: 'white',
          }}>
            {filteredBuses.slice(0, 10).map((bus) => (
              <div
                key={bus.id}
                onClick={() => {
                  setSelectedBus(bus);
                  setShowSearchResults(false);
                  // Center map on selected bus
                  setViewState(prev => ({
                    ...prev,
                    longitude: bus.longitude,
                    latitude: bus.latitude,
                    zoom: Math.max(prev.zoom, 15),
                  }));
                }}
                style={{
                  padding: isMobile ? '12px' : '10px 12px',
                  cursor: 'pointer',
                  borderBottom: '1px solid #f0f0f0',
                  transition: 'background 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f5f5f5';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'white';
                }}
              >
                <div style={{ fontWeight: '600', color: '#333', marginBottom: '4px' }}>
                  Bus ID: {bus.id}
                </div>
                <div style={{ fontSize: '12px', color: '#666' }}>
                  Route: {bus.routeId || 'N/A'} | Trip: {bus.tripId || 'N/A'}
                </div>
              </div>
            ))}
            {filteredBuses.length > 10 && (
              <div style={{
                padding: '8px 12px',
                fontSize: '12px',
                color: '#999',
                textAlign: 'center',
                borderTop: '1px solid #e0e0e0',
              }}>
                +{filteredBuses.length - 10} more results
              </div>
            )}
          </div>
        )}
        
        {showSearchResults && searchQuery.trim() && filteredBuses.length === 0 && (
          <div style={{
            padding: '12px',
            textAlign: 'center',
            color: '#999',
            fontSize: '14px',
            borderTop: '1px solid #e0e0e0',
          }}>
            No buses found
          </div>
        )}
      </div>

      {glError && (
        <div style={{
          position: 'absolute',
          top: isMobile ? '70px' : '80px',
          left: isMobile ? '10px' : '20px',
          zIndex: 1001,
          color: 'white',
          background: 'rgba(220, 53, 69, 0.9)',
          padding: '10px 20px',
          borderRadius: '5px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          maxWidth: isMobile ? 'calc(100% - 20px)' : '400px',
        }}>
          <strong>WebGL Error:</strong> {glError}
          <br />
          <small>Try refreshing the page or updating your graphics drivers.</small>
        </div>
      )}

      {/* Stats Panel */}
      <div style={{
        position: 'absolute',
        top: isMobile ? '70px' : '20px',
        right: isMobile ? '10px' : '20px',
        zIndex: 1000,
        color: 'black',
        background: 'white',
        padding: isMobile ? '8px 12px' : '10px 20px',
        borderRadius: '5px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        fontSize: isMobile ? '12px' : '14px',
      }}>
        <div>Active Buses: {validBusPositions.length} / {vehicles.length}</div>
        {searchQuery.trim() && (
          <div style={{ color: '#fd805d', fontWeight: '600' }}>
            Showing: {filteredBuses.length}
          </div>
        )}
        <div>Stops: {validStops.length} / {stops.length}</div>
        <div>Routes: {routes.length}</div>
      </div>

      {selectedStop && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: 20,
          right: 20,
          maxWidth: '400px',
          zIndex: 1000,
          color: 'black',
          background: 'white',
          padding: '15px 20px',
          borderRadius: '5px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '18px' }}>{selectedStop.name}</h3>
            <button
              onClick={() => setSelectedStop(null)}
              style={{
                background: '#f0f0f0',
                border: 'none',
                borderRadius: '4px',
                padding: '5px 10px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              ✕
            </button>
          </div>
          {selectedStop.code && (
            <div style={{ marginBottom: '5px', color: '#666' }}>
              <strong>Stop Code:</strong> {selectedStop.code}
            </div>
          )}
          <div style={{ marginBottom: '5px', color: '#666' }}>
            <strong>Stop ID:</strong> {selectedStop.id}
          </div>
          <div style={{ color: '#666', fontSize: '12px' }}>
            Coordinates: {selectedStop.latitude.toFixed(6)}, {selectedStop.longitude.toFixed(6)}
          </div>
        </div>
      )}

      {selectedBus && (
        <div style={{
          position: 'absolute',
          bottom: selectedStop ? (isMobile ? '180px' : '120px') : (isMobile ? '20px' : '20px'),
          left: isMobile ? '10px' : '20px',
          right: isMobile ? '10px' : '20px',
          maxWidth: isMobile ? 'calc(100% - 20px)' : '400px',
          zIndex: 1000,
          color: 'black',
          background: 'white',
          padding: isMobile ? '12px 15px' : '15px 20px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          touchAction: 'none', // Prevent map panning when interacting with popup
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: 0, fontSize: isMobile ? '16px' : '18px', color: '#fd805d' }}>🚌 Bus Information</h3>
            <button
              onClick={() => setSelectedBus(null)}
              style={{
                background: '#f0f0f0',
                border: 'none',
                borderRadius: '4px',
                padding: isMobile ? '8px 12px' : '5px 10px',
                cursor: 'pointer',
                fontSize: isMobile ? '18px' : '14px',
                minWidth: isMobile ? '44px' : 'auto', // Minimum touch target size
                minHeight: isMobile ? '44px' : 'auto',
                touchAction: 'manipulation', // Better touch handling
              }}
              aria-label="Close bus information"
            >
              ✕
            </button>
          </div>
          <div style={{ marginBottom: '10px' }}>
            <div style={{ marginBottom: isMobile ? '8px' : '5px', color: '#666', fontSize: isMobile ? '14px' : 'inherit' }}>
              <strong>Numberplate/ID:</strong> {selectedBus.id}
            </div>
            <div style={{ marginBottom: isMobile ? '8px' : '5px', color: '#666', fontSize: isMobile ? '14px' : 'inherit' }}>
              <strong>Route ID:</strong> {selectedBus.routeId || 'N/A'}
            </div>
            <div style={{ marginBottom: isMobile ? '8px' : '5px', color: '#666', fontSize: isMobile ? '14px' : 'inherit' }}>
              <strong>Trip ID:</strong> {selectedBus.tripId || 'N/A'}
            </div>
            {(() => {
              const nextStop = findNextStop(selectedBus);
              return (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #e0e0e0' }}>
                  <div style={{ marginBottom: '5px', color: '#333', fontWeight: '600' }}>
                    <strong>Next Stop:</strong>
                  </div>
                  {nextStop ? (
                    <>
                      <div style={{ color: '#666', fontSize: '14px' }}>
                        {nextStop.name}
                      </div>
                      {nextStop.code && (
                        <div style={{ color: '#999', fontSize: '12px', marginTop: '2px' }}>
                          Code: {nextStop.code}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ color: '#999', fontSize: '14px', fontStyle: 'italic' }}>
                      No next stop information available
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <div style={{ 
            color: '#999', 
            fontSize: isMobile ? '11px' : '12px', 
            marginTop: '10px', 
            paddingTop: '10px', 
            borderTop: '1px solid #e0e0e0',
            lineHeight: isMobile ? '1.5' : '1.4',
          }}>
            <div style={{ marginBottom: isMobile ? '4px' : '0' }}>
              Speed: {(selectedBus.speed * 3.6).toFixed(1)} km/h
            </div>
            {isMobile && (
              <div>
                Position: {selectedBus.latitude.toFixed(4)}, {selectedBus.longitude.toFixed(4)}
              </div>
            )}
            {!isMobile && (
              <>Position: {selectedBus.latitude.toFixed(6)}, {selectedBus.longitude.toFixed(6)}</>
            )}
          </div>
        </div>
      )}

      <DeckGL
        initialViewState={viewState}
        controller={{
          doubleClickZoom: true,
          dragRotate: false, // Disable rotation on mobile for better touch interaction
          touchZoom: true,
          touchRotate: false, // Disable rotation on touch
          keyboard: false, // Disable keyboard controls on mobile
          scrollZoom: !isMobile, // Disable scroll zoom on mobile (use pinch instead)
        }}
        layers={layers}
        onViewStateChange={(evt) => {
          if ('viewState' in evt) {
            setViewState(evt.viewState as ViewState);
          }
        }}
        onError={(error: Error) => {
          console.error('DeckGL error:', error);
          setGlError(error.message || 'WebGL error occurred');
        }}
        onWebGLInitialized={(_gl) => {
          // WebGL context successfully initialized
          setGlError(null);
        }}
        getTooltip={({ object }) => {
          if (object && 'name' in object) {
            const stop = object as Stop;
            return {
              html: `<div style="padding: 8px;">
                <strong>${stop.name}</strong><br/>
                ${stop.code ? `Code: ${stop.code}` : ''}
              </div>`,
              style: {
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                fontSize: '12px',
              }
            };
          }
          return null;
        }}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        <MapGL
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          longitude={viewState.longitude}
          latitude={viewState.latitude}
          zoom={viewState.zoom}
          pitch={viewState.pitch}
          bearing={viewState.bearing}
          onMove={(evt) => {
            setViewState(evt.viewState as ViewState);
          }}
          reuseMaps={true}
        />
      </DeckGL>
    </div>
  );
}

