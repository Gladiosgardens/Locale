import * as Location from 'expo-location';
import { encodeGeohash, geohashCenter } from './geohash';

export type LocatedArea = { geohash5: string; name: string };

export class LocationDeniedError extends Error {
  constructor() {
    super('location_denied');
  }
}

// Turn the device's approximate position into a coarse area cell.
// Only the cell leaves the device: we reverse-geocode the *cell centre*
// (not the user's position) so the OS geocoder never sees the real point,
// and we send Supabase just the geohash and a neighborhood name.
export async function locateArea(): Promise<LocatedArea> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new LocationDeniedError();

  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
  const geohash5 = encodeGeohash(position.coords.latitude, position.coords.longitude);
  const center = geohashCenter(geohash5);

  let name = '';
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude: center.lat, longitude: center.lng });
    name = place?.district || place?.city || place?.subregion || '';
  } catch {
    // Fall through to a generic name; the user still gets placed in the right cell.
  }
  return { geohash5, name: name.trim().slice(0, 60) || 'My neighborhood' };
}
