// Type definitions matching BusMap.tsx
export interface Stop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  code?: string;
  routeId?: string | null; // Route ID from stops.txt (for train stations)
}

export interface Route {
  id: string;
  path: [number, number][];
  timestamps: number[];
  routeId: string | null;
}

export interface Agency {
  agency: string;
  category?: string;
}

interface CSVRow {
  [key: string]: string;
}

interface CachedFile {
  key: string;
  agency: string;
  category: string;
  filename: string;
  content: string;
  timestamp: number;
}

interface TripInfo {
  tripId: string;
  routeId: string | null;
}

interface StopSequence {
  stopId: string;
  sequence: number;
}

// Cache management using IndexedDB
const DB_NAME = 'gtfs_cache';
const DB_VERSION = 1;
const STORE_NAME = 'gtfs_files';

/**
 * Initialize IndexedDB for caching GTFS files
 */
async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

/**
 * Generate cache key for agency/category/filename
 */
function getCacheKey(agency: string, category: string | null | undefined, filename: string): string {
  const categoryPart = category ? `/${category}` : '';
  return `${agency}${categoryPart}/${filename}`;
}

/**
 * Store a GTFS file in cache
 */
async function storeFileInCache(
  agency: string,
  category: string | null | undefined,
  filename: string,
  content: string
): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    const key = getCacheKey(agency, category, filename);
    await store.put({
      key,
      agency,
      category: category || '',
      filename,
      content,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.warn('Failed to store file in cache:', error);
  }
}

/**
 * Retrieve a GTFS file from cache
 */
async function getFileFromCache(
  agency: string,
  category: string | null | undefined,
  filename: string
): Promise<string | null> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
    const key = getCacheKey(agency, category, filename);
    const request = store.get(key);
    
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const result = request.result as CachedFile | undefined;
        if (result && result.content) {
          resolve(result.content);
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('Failed to get file from cache:', error);
    return null;
  }
}

/**
 * Download and cache all GTFS files from ZIP
 * Always attempts to process the response as a ZIP file regardless of content-type header
 */
async function downloadAndCacheGTFSFiles(
  agency: string,
  category: string | null | undefined
): Promise<boolean> {
  try {
    let url = `https://api.data.gov.my/gtfs-static/${agency}`;
    
    if (agency === 'prasarana' && category) {
      url += `?category=${category}`;
    }

    console.log(`Downloading GTFS ZIP from: ${url}`);
    const response = await fetch(url);
    
    console.log('Response Status:', response.status, response.statusText);
    console.log('Response URL:', response.url);
    console.log('Content-Type:', response.headers.get('content-type') || '(not set)');
    
    if (!response.ok) {
      console.warn(`Failed to fetch GTFS static data from ${url}: ${response.status} ${response.statusText}`);
      return false;
    }

    // Download the response as array buffer (always try as ZIP)
    const arrayBuffer = await response.arrayBuffer();
    console.log('Downloaded file size:', arrayBuffer.byteLength, 'bytes');
    
    // Check if it looks like a ZIP file by checking the magic bytes
    // ZIP files start with PK (0x50 0x4B) - this is the ZIP file signature
    const view = new Uint8Array(arrayBuffer);
    const isZip = view.length >= 2 && view[0] === 0x50 && view[1] === 0x4B;
    
    if (!isZip) {
      console.warn('File does not appear to be a ZIP file (missing PK header)');
      console.log('First 10 bytes:', Array.from(view.slice(0, 10)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
      // Try to read as text to see what we got
      try {
        const text = new TextDecoder().decode(view.slice(0, 200));
        console.log('First 200 chars as text:', text);
      } catch (e) {
        // Ignore text decode errors
      }
      return false;
    }
    
    console.log('File appears to be a valid ZIP file, processing...');
    
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(arrayBuffer);
      
      // Extract and cache all files from the ZIP
      const filePromises: Promise<void | null>[] = [];
      const fileNames = Object.keys(zip.files);
      
      console.log(`Found ${fileNames.length} files in ZIP for ${agency}${category ? `/${category}` : ''}`);
      
      if (fileNames.length === 0) {
        console.warn('ZIP file is empty or contains no files');
        return false;
      }
      
      for (const relativePath of fileNames) {
        const file = zip.files[relativePath];
        if (file && !file.dir) {
          const filename = relativePath.split('/').pop() || relativePath; // Get just the filename
          console.log(`Extracting and caching file: ${filename}`);
          filePromises.push(
            file.async('string').then(content => {
              console.log(`Stored ${filename} in cache (${content.length} chars)`);
              return storeFileInCache(agency, category, filename, content);
            }).catch(err => {
              console.error(`Error caching ${filename}:`, err);
              return null;
            })
          );
        }
      }
      
      if (filePromises.length === 0) {
        console.warn('No files found in ZIP to cache (all entries are directories)');
        return false;
      }
      
      await Promise.all(filePromises);
      console.log(`Successfully cached ${filePromises.length} GTFS files for ${agency}${category ? `/${category}` : ''}`);
      return true;
    } catch (zipError) {
      console.error('Error processing ZIP file:', zipError);
      if (zipError instanceof Error) {
        console.error('ZIP error details:', zipError.message, zipError.stack);
      }
      return false;
    }
  } catch (error) {
    console.error('Error downloading and caching GTFS files:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message, error.stack);
    }
    return false;
  }
}

/**
 * Load a GTFS file from cache or download if not cached
 */
async function loadGTFSFile(
  agency: string,
  category: string | null | undefined,
  filename: string
): Promise<string | null> {
  // Try cache first
  let content = await getFileFromCache(agency, category, filename);
  
  if (content) {
    return content;
  }
  
  // If not in cache, download and cache all files
  console.log(`File ${filename} not in cache, downloading GTFS files for ${agency}${category ? `/${category}` : ''}`);
  const success = await downloadAndCacheGTFSFiles(agency, category);
  
  if (success) {
    // Try cache again after download
    content = await getFileFromCache(agency, category, filename);
    return content;
  }
  
  return null;
}

/**
 * Parses CSV text into array of objects
 */
function parseCSV(text: string): CSVRow[] {
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length === 0) return [];
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const data: CSVRow[] = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    
    // Simple CSV parsing (handles quoted values)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let j = 0; j < lines[i].length; j++) {
      const char = lines[i][j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    
    const row: CSVRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.replace(/^"|"$/g, '') || '';
    });
    data.push(row);
  }
  
  return data;
}

/**
 * Fetches GTFS Static stops data from cache or downloads if not available
 * @param agency - Agency name (e.g., 'prasarana', 'ktmb')
 * @param category - Optional category for Prasarana
 * @returns Promise resolving to array of stop objects with lat/lng
 */
export async function fetchGTFSStops(
  agency: string = 'prasarana',
  category: string = 'rapid-bus-kl'
): Promise<Stop[]> {
  try {
    // Load stops.txt from cache or download
    const stopsText = await loadGTFSFile(agency, category, 'stops.txt');
    
    if (!stopsText) {
      console.warn(`Failed to load stops.txt for ${agency}${category ? `/${category}` : ''}`);
      return [];
    }
    
    const stopsData = parseCSV(stopsText);
    
    return stopsData
      .filter(stop => stop.stop_lat && stop.stop_lon)
      .map(stop => ({
        id: stop.stop_id,
        name: stop.stop_name,
        latitude: parseFloat(stop.stop_lat),
        longitude: parseFloat(stop.stop_lon),
        code: stop.stop_code || undefined,
        routeId: stop.route_id || undefined, // Extract route_id if present in stops.txt
      }));
  } catch (error) {
    console.error('Error fetching GTFS Static stops data:', error);
    return [];
  }
}

/**
 * Clear cache for a specific agency/category or all cache
 * @param agency - Agency name (optional, clears all if not provided)
 * @param category - Category name (optional)
 */
export async function clearGTFSCache(
  agency: string | null = null,
  category: string | null = null
): Promise<void> {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    if (agency) {
      // Clear specific agency/category
      const keyPrefix = getCacheKey(agency, category, '');
      const request = store.openCursor();
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          if (typeof cursor.key === 'string' && cursor.key.startsWith(keyPrefix)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
    } else {
      // Clear all cache
      await store.clear();
    }
    
    console.log(`Cache cleared for ${agency ? `${agency}${category ? `/${category}` : ''}` : 'all'}`);
  } catch (error) {
    console.error('Error clearing cache:', error);
  }
}

/**
 * Fetches stops for multiple agencies
 */
export async function fetchMultipleAgencyStops(agencies: Agency[]): Promise<Stop[]> {
  const promises = agencies.map(({ agency, category }) => 
    fetchGTFSStops(agency, category)
  );
  
  const results = await Promise.all(promises);
  return results.flat();
}

/**
 * Fetches a GTFS file from cache or downloads if not available
 * @param agency - Agency name
 * @param category - Optional category
 * @param filename - Name of the GTFS file to fetch
 * @returns Promise resolving to CSV text content or null if not found
 */
async function fetchGTFSFile(
  agency: string,
  category: string | null | undefined,
  filename: string
): Promise<string | null> {
  return await loadGTFSFile(agency, category, filename);
}

/**
 * Compiles trips CSV to map trip_id to route info
 * @param tripsText - CSV text from trips.txt
 * @returns Map of trip_id to {routeId, tripId}
 */
function compileTripsFromCSV(tripsText: string): Map<string, TripInfo> {
  const tripsData = parseCSV(tripsText);
  const tripToRouteMap = new Map<string, TripInfo>();
  
  tripsData.forEach(trip => {
    const tripId = trip.trip_id;
    if (tripId) {
      tripToRouteMap.set(tripId, {
        tripId: trip.trip_id,
        routeId: trip.route_id || null,
      });
    }
  });
  
  return tripToRouteMap;
}

/**
 * Compiles stop_times CSV to get stop sequences for each trip
 * @param stopTimesText - CSV text from stop_times.txt
 * @returns Map of trip_id to array of {stop_id, stop_sequence}
 */
function compileStopTimesFromCSV(stopTimesText: string): Map<string, StopSequence[]> {
  const stopTimesData = parseCSV(stopTimesText);
  const tripToStopsMap = new Map<string, StopSequence[]>();
  
  stopTimesData.forEach(stopTime => {
    const tripId = stopTime.trip_id;
    const stopId = stopTime.stop_id;
    const sequence = parseInt(stopTime.stop_sequence, 10);
    
    if (tripId && stopId && !isNaN(sequence)) {
      if (!tripToStopsMap.has(tripId)) {
        tripToStopsMap.set(tripId, []);
      }
      
      tripToStopsMap.get(tripId)!.push({
        stopId,
        sequence,
      });
    }
  });
  
  // Sort stops by sequence for each trip
  tripToStopsMap.forEach((stops) => {
    stops.sort((a, b) => a.sequence - b.sequence);
  });
  
  return tripToStopsMap;
}

/**
 * Creates route paths from stops and stop sequences
 * Connects stops in sequence to form paths
 * @param stops - Array of stop objects with id, latitude, longitude
 * @param tripToStopsMap - Map of trip_id to stop sequences
 * @param tripToRouteMap - Map of trip_id to route info
 * @returns Array of route path objects
 */
function compileRoutesFromStops(
  stops: Stop[],
  tripToStopsMap: Map<string, StopSequence[]>,
  tripToRouteMap: Map<string, TripInfo>
): Route[] {
  // Create a map of stop_id to stop coordinates for quick lookup
  const stopsMap = new Map<string, { latitude: number; longitude: number }>();
  stops.forEach(stop => {
    stopsMap.set(stop.id, {
      latitude: stop.latitude,
      longitude: stop.longitude,
    });
  });
  
  const routes: Route[] = [];
  
  tripToStopsMap.forEach((stopSequences, tripId) => {
    // Get route info for this trip
    const routeInfo = tripToRouteMap.get(tripId) || { tripId, routeId: null };
    
    // Build path from stop sequences
    const path: [number, number][] = [];
    const timestamps: number[] = [];
    const baseTime = Date.now() / 1000;
    
    stopSequences.forEach((stopSeq, index) => {
      const stop = stopsMap.get(stopSeq.stopId);
      if (stop) {
        path.push([stop.longitude, stop.latitude]);
        // Generate timestamps - 30 seconds between stops
        timestamps.push(baseTime + index * 30);
      }
    });
    
    // Only add routes with at least 2 stops
    if (path.length >= 2) {
      routes.push({
        id: tripId,
        path,
        timestamps,
        routeId: routeInfo.routeId,
      });
    }
  });
  
  return routes;
}

/**
 * Loads route data from cached GTFS files
 * @param agency - Agency name (e.g., 'prasarana', 'ktmb')
 * @param category - Optional category for Prasarana
 * @returns Promise resolving to array of route path objects ready for TripsLayer
 */
export async function loadRouteData(
  agency: string = 'prasarana',
  category: string = 'rapid-bus-kl'
): Promise<Route[]> {
  try {
    // Load stops, trips, and stop_times from cache
    const [stops, tripsText, stopTimesText] = await Promise.all([
      fetchGTFSStops(agency, category),
      loadGTFSFile(agency, category, 'trips.txt'),
      loadGTFSFile(agency, category, 'stop_times.txt'),
    ]);
    
    // If we don't have the required files, return empty array
    if (!tripsText || !stopTimesText || stops.length === 0) {
      console.warn('Missing required GTFS files (trips.txt, stop_times.txt) or stops data');
      return [];
    }
    
    // Compile trips and stop sequences
    const tripToRouteMap = compileTripsFromCSV(tripsText);
    const tripToStopsMap = compileStopTimesFromCSV(stopTimesText);
    
    // Build routes from stops
    return compileRoutesFromStops(stops, tripToStopsMap, tripToRouteMap);
  } catch (error) {
    console.error('Error loading route data:', error);
    return [];
  }
}

/**
 * Fetches and compiles bus routes as paths for the Trips layer
 * Since shapes.txt is not available, builds paths from stops and stop sequences
 * This function now uses the cache system
 * @param agency - Agency name (e.g., 'prasarana', 'ktmb')
 * @param category - Optional category for Prasarana
 * @returns Promise resolving to array of route path objects ready for TripsLayer
 */
export async function fetchGTFSRoutes(
  agency: string = 'prasarana',
  category: string = 'rapid-bus-kl'
): Promise<Route[]> {
  // Use the loadRouteData function which handles caching
  return await loadRouteData(agency, category);
}

/**
 * Fetches routes for multiple agencies
 * @param agencies - Array of {agency, category} objects
 * @returns Promise resolving to combined array of all route paths
 */
export async function fetchMultipleAgencyRoutes(agencies: Agency[]): Promise<Route[]> {
  const promises = agencies.map(({ agency, category }) => 
    fetchGTFSRoutes(agency, category)
  );
  
  const results = await Promise.all(promises);
  return results.flat();
}

/**
 * Train line color mapping
 */
export const LINE_COLORS: Record<string, [number, number, number]> = {
  "MRT": [0, 128, 0],      // green
  "KJ": [255, 0, 0],        // red
  "PH": [139, 69, 19],      // brown
  "AG": [255, 165, 0],     // orange
  "ktmb": [0, 0, 255],      // blue
  "PYL": [255, 255, 0],     // yellow
  "BRT": [0, 100, 0],       // darkgreen
  "MR": [144, 238, 144],    // lightgreen
};

/**
 * Gets the color for a stop based on its route_id
 * @param stop - Stop object with optional routeId
 * @returns RGB color array [r, g, b, alpha] or null if not a train station
 */
export function getStopColor(stop: Stop): [number, number, number, number] | null {
  if (!stop.routeId) {
    return null; // Not a train station
  }
  
  const routeId = stop.routeId.toUpperCase();
  
  // Check if route_id starts with any train line prefix
  for (const [linePrefix, color] of Object.entries(LINE_COLORS)) {
    if (routeId.startsWith(linePrefix.toUpperCase())) {
      return [...color, 255]; // Return color with alpha
    }
  }
  
  return null; // Route ID doesn't match any train line
}

