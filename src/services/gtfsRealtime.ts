import { transit_realtime } from 'gtfs-realtime-bindings';

// Type definitions matching BusMap.tsx
export interface Vehicle {
  id: string;
  tripId: string | null;
  routeId: string | null;
  latitude: number;
  longitude: number;
  bearing: number;
  speed: number;
  timestamp: number;
}

export interface Agency {
  agency: string;
  category?: string;
}

/**
 * Fetches GTFS Realtime vehicle position data from Malaysia's Open API
 * @param agency - Agency name (e.g., 'prasarana', 'ktmb', 'mybas-kangar')
 * @param category - Optional category for Prasarana (e.g., 'rapid-bus-kl')
 * @returns Promise resolving to array of vehicle position objects
 */
export async function fetchGTFSRealtime(
  agency: string = 'prasarana',
  category: string = 'rapid-bus-kl'
): Promise<Vehicle[]> {
  try {
    let url = `https://api.data.gov.my/gtfs-realtime/vehicle-position/${agency}`;
    
    // Add category query parameter for Prasarana
    if (agency === 'prasarana' && category) {
      url += `?category=${category}`;
    }

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const feed = transit_realtime.FeedMessage.decode(new Uint8Array(arrayBuffer));

    // Extract vehicle positions
    const vehicles: Vehicle[] = [];
    for (const entity of feed.entity) {
      if (entity.vehicle) {
        const vehicle = entity.vehicle;
        if (vehicle.position) {
          // Handle protobuf nested objects - they may be accessed differently
          const vehicleDescriptor = vehicle.vehicle;
          const vehicleId = (vehicleDescriptor && vehicleDescriptor.id) 
            ? (vehicleDescriptor.id.id || vehicleDescriptor.id) 
            : entity.id;
          
          const trip = vehicle.trip || {};
          const tripId = trip.tripId || null;
          const routeId = trip.routeId || null;
          
          const position = vehicle.position;
          const latitude = position.latitude || 0;
          const longitude = position.longitude || 0;
          const bearing = position.bearing || 0;
          const speed = position.speed || 0;
          const timestamp = vehicle.timestamp || Math.floor(Date.now() / 1000);
          
          // Only add if we have valid coordinates
          if (latitude !== 0 && longitude !== 0) {
            vehicles.push({
              id: vehicleId || entity.id,
              tripId: tripId as string | null,
              routeId: routeId as string | null,
              latitude,
              longitude,
              bearing,
              speed,
              timestamp,
            });
          }
        }
      }
    }

    return vehicles;
  } catch (error) {
    console.error('Error fetching GTFS Realtime data:', error);
    return [];
  }
}

/**
 * Fetches GTFS Realtime data from multiple agencies
 * @param agencies - Array of {agency, category} objects
 * @returns Promise resolving to combined array of all vehicle positions
 */
export async function fetchMultipleAgencies(agencies: Agency[]): Promise<Vehicle[]> {
  const promises = agencies.map(({ agency, category }) => 
    fetchGTFSRealtime(agency, category)
  );
  
  const results = await Promise.all(promises);
  return results.flat();
}

