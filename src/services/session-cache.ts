import _ from "lodash";

import Place, { PlaceUploadState } from "./place";
import { ChtSession, ParentDetails } from "../lib/cht-api";

export type SessionCacheUploadState = "in_progress" | "done" | "pending";

export default class SessionCache {
  private static caches: Map<string, SessionCache> = new Map();

  public state: SessionCacheUploadState = 'pending';
  private places: { [key: string]: Place } = {};
  private searchResultCache: Map<string, ParentDetails> = new Map();
  
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

  public getPlaces = (options?: { type?: string, state?: PlaceUploadState, created?: boolean, id?: string }) : Place[] => {
    return Object.values(this.places)
      .filter(p => !options?.type || p.type.name === options.type)
      .filter(p => !options?.state || p.state === options.state)
      .filter(p => !options?.id || p.id === options.id)
      .filter(p => options?.created === undefined || !!p.isCreated === options.created);
  }

  public findKnownPlace = (placeType: string, searchStr: string, options?: { exact: boolean })
    : ParentDetails[] =>
  {
    const uncreatedPlaces = this.getPlaces({ type: placeType }).filter(p => !p.isCreated);
    const placeDetails: ParentDetails[] = [
      ...uncreatedPlaces.map(p => p.asParentDetails()),
      ...this.searchResultCache.values(),
    ];

    return placeDetails
      .filter((details: ParentDetails) => {
        if (options?.exact) {
          return details.name === searchStr;
        }

        return details.name.toUpperCase().includes(searchStr.toUpperCase());
      });
  };

  public saveKnownParents = (...results: ParentDetails[]) => {
    results.forEach((place) => {
      this.searchResultCache.set(place.id, place);
    });
  };

  public getKnownParent = (id: string): ParentDetails | undefined => {
    let result = this.searchResultCache.get(id);
    if (!result) {
      const [uncreatedPlace] = this.getPlaces({ created: false, id });
      if (uncreatedPlace) {
        result = uncreatedPlace.asParentDetails();
      }
    }
    
    return result;
  };
}
