import Place, { PlaceUploadState } from './place';
import { ChtSession } from '../lib/cht-api';

export type SessionCacheUploadState = 'in_progress' | 'done' | 'pending';

export default class SessionCache {
  private static caches: Map<string, SessionCache> = new Map();
  private places: { [key: string]: Place } = {};

  private constructor() {}

  public static getForSession = (session: ChtSession): SessionCache => {
    const lookup = session.sessionToken;
    let sessionCache = this.caches.get(lookup);
    if (!sessionCache) {
      sessionCache = new SessionCache();
      this.caches.set(lookup, sessionCache);
    }

    return sessionCache;
  };

  public savePlaces = (...places: Place[]) => {
    for (const place of places) {
      this.places[place.id] = place;
    }
  };

  public getPlace = (id: string): Place | undefined => this.places[id];

  public getPlaces = (options?: {
    type?: string;
    state?: PlaceUploadState;
    created?: boolean;
    id?: string;
    nameExact?: string;
    nameIncludes?: string;
  }) : Place[] => {
    return Object.values(this.places)
      .filter(p => !options?.type || p.type.name === options.type)
      .filter(p => !options?.state || p.state === options.state)
      .filter(p => !options?.id || p.id === options.id)
      .filter(p => !options?.nameExact || p.name === options.nameExact)
      .filter(p => !options?.nameIncludes || p.name.toLowerCase().includes(options.nameIncludes.toLowerCase()))
      .filter(p => options?.created === undefined || !!p.isCreated === options.created);
  };

  public removePlace = (placeId: string): void => {
    if (!this.places[placeId]) {
      throw Error(`cannot find placeId "${placeId}"`);
    }

    delete this.places[placeId];
  };

  public removeAll = (): void => {
    this.places = {};
  };
}
