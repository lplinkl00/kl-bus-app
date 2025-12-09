/**
 * Google Routes API service
 * Provides road-following route paths between waypoints
 */

// Google Directions API configuration (using Directions API for better compatibility)
const GOOGLE_ROUTES_API_KEY = import.meta.env.VITE_GOOGLE_ROUTES_API_KEY || import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const GOOGLE_DIRECTIONS_API_URL = 'https://maps.googleapis.com/maps/api/directions/json';

// Cache for computed routes (session storage)
const routeCache = new Map<string, [number, number][]>();

// Rate limiting: Google Routes API allows 50 requests per second
const MAX_REQUESTS_PER_SECOND = 40; // Conservative limit
const REQUEST_DELAY_MS = 1000 / MAX_REQUESTS_PER_SECOND;

// Queue for rate limiting
let requestQueue: Array<() => Promise<void>> = [];
let isProcessingQueue = false;

/**
 * Generate a cache key for a route segment
 */
function getCacheKey(waypoints: Array<{ lat: number; lng: number }>): string {
  return waypoints.map(wp => `${wp.lat.toFixed(6)},${wp.lng.toFixed(6)}`).join('|');
}

/**
 * Process the request queue with rate limiting
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue) {
    return;
  }

  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const request = requestQueue.shift();
    if (request) {
      await request();
      // Rate limiting delay
      if (requestQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
      }
    }
  }

  isProcessingQueue = false;
}

/**
 * Get road-following route between waypoints using Google Routes API
 * @param waypoints - Array of {lat, lng} waypoints
 * @returns Promise resolving to array of [longitude, latitude] coordinates
 */
export async function getRoutePath(
  waypoints: Array<{ lat: number; lng: number }>
): Promise<[number, number][]> {
  if (!GOOGLE_ROUTES_API_KEY) {
    console.warn('Google Routes API key not configured. Falling back to straight-line paths.');
    // Fallback to straight line
    return waypoints.map(wp => [wp.lng, wp.lat]);
  }

  if (waypoints.length < 2) {
    return waypoints.map(wp => [wp.lng, wp.lat]);
  }

  // Check cache first
  const cacheKey = getCacheKey(waypoints);
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey)!;
  }

  // For routes with many waypoints, we'll batch them
  // Google Routes API supports up to 25 intermediate waypoints
  const MAX_WAYPOINTS = 25;
  
  if (waypoints.length > MAX_WAYPOINTS) {
    // Split into segments and combine
    const segments: [number, number][] = [];
    for (let i = 0; i < waypoints.length - 1; i += MAX_WAYPOINTS - 1) {
      const segmentWaypoints = waypoints.slice(i, Math.min(i + MAX_WAYPOINTS, waypoints.length));
      const segmentPath = await getRoutePath(segmentWaypoints);
      if (i > 0) {
        // Remove first point to avoid duplication
        segments.push(...segmentPath.slice(1));
      } else {
        segments.push(...segmentPath);
      }
    }
    routeCache.set(cacheKey, segments);
    return segments;
  }

  // Make API request with rate limiting using Google Directions API
  return new Promise((resolve) => {
    const makeRequest = async () => {
      try {
        // Build waypoints string for Directions API
        // Directions API supports up to 25 waypoints (origin + destination + 23 intermediates)
        const origin = `${waypoints[0].lat},${waypoints[0].lng}`;
        const destination = `${waypoints[waypoints.length - 1].lat},${waypoints[waypoints.length - 1].lng}`;
        const waypointsStr = waypoints.slice(1, -1)
          .map(wp => `${wp.lat},${wp.lng}`)
          .join('|');

        const url = new URL(GOOGLE_DIRECTIONS_API_URL);
        url.searchParams.set('origin', origin);
        url.searchParams.set('destination', destination);
        if (waypointsStr) {
          url.searchParams.set('waypoints', waypointsStr);
        }
        url.searchParams.set('key', GOOGLE_ROUTES_API_KEY);
        url.searchParams.set('mode', 'driving');
        url.searchParams.set('alternatives', 'false');

        const response = await fetch(url.toString());

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Google Directions API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        
        if (data.status !== 'OK' || !data.routes || data.routes.length === 0) {
          // Fallback to straight line
          const fallbackPath = waypoints.map(wp => [wp.lng, wp.lat]);
          routeCache.set(cacheKey, fallbackPath);
          resolve(fallbackPath);
          return;
        }

        // Decode the polyline from the overview_polyline
        const encodedPolyline = data.routes[0].overview_polyline?.points;
        if (!encodedPolyline) {
          // Fallback to straight line
          const fallbackPath = waypoints.map(wp => [wp.lng, wp.lat]);
          routeCache.set(cacheKey, fallbackPath);
          resolve(fallbackPath);
          return;
        }

        const decodedPath = decodePolyline(encodedPolyline);
        routeCache.set(cacheKey, decodedPath);
        resolve(decodedPath);
      } catch (error) {
        console.warn('Error fetching route from Google Directions API:', error);
        // Fallback to straight line on error
        const fallbackPath = waypoints.map(wp => [wp.lng, wp.lat]);
        routeCache.set(cacheKey, fallbackPath);
        resolve(fallbackPath);
      }
    };

    requestQueue.push(makeRequest);
    processQueue();
  });
}

/**
 * Decode Google's encoded polyline format
 * @param encoded - Encoded polyline string
 * @returns Array of [longitude, latitude] coordinates
 */
function decodePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
}

/**
 * Batch process multiple routes
 * @param routeWaypoints - Array of route waypoint arrays
 * @param onProgress - Optional progress callback
 * @returns Promise resolving to array of route paths
 */
export async function batchGetRoutePaths(
  routeWaypoints: Array<Array<{ lat: number; lng: number }>>,
  onProgress?: (current: number, total: number) => void
): Promise<Array<[number, number][]>> {
  const results: Array<[number, number][]> = [];
  
  for (let i = 0; i < routeWaypoints.length; i++) {
    const waypoints = routeWaypoints[i];
    const path = await getRoutePath(waypoints);
    results.push(path);
    
    if (onProgress) {
      onProgress(i + 1, routeWaypoints.length);
    }
  }
  
  return results;
}

/**
 * Clear the route cache (useful for testing or when routes need to be refreshed)
 */
export function clearRouteCache(): void {
  routeCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): { size: number } {
  return { size: routeCache.size };
}

