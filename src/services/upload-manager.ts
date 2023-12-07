import EventEmitter from "events";
import { ChtApi, PlacePayload } from "../lib/cht-api";

import Place, { PlaceUploadState, UserCreationDetails } from "./place";
import { UserPayload } from "./user-payload";
import SessionCache, { SessionCacheUploadState } from "./session-cache";
import { UploadReplacementPlace } from "./upload.replacement";
import { UploadNewPlace } from "./upload.new";
import { Config } from "../lib/config";

export type JobState = {
  placeId: string;
  state: PlaceUploadState;
};

export interface Uploader {
   handleContact (payload: PlacePayload): Promise<string | undefined>;
   handlePlacePayload (place: Place, payload: PlacePayload) : Promise<string>;
   linkContactAndPlace (place: Place, placeId: string): Promise<void>;
}

export class UploadManager extends EventEmitter {
  doUpload = async (places: Place[], chtApi: ChtApi) => {
    const placesNeedingUpload = places.filter(p => !p.isCreated && p.invalidProperties?.length === 0);
    this.eventedPlaceStateChange(placesNeedingUpload, PlaceUploadState.SCHEDULED);

    for (const place of placesNeedingUpload) {
      this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGESS);

      try {
        await this.uploadPlace(place, chtApi);
        this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
      } catch (err: any) {
        console.error('error when uploading place', err.response?.data || err);
        this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
      }
    }
  };

  private uploadPlace = async (place: Place, chtApi: ChtApi): Promise<UserCreationDetails> => {
    const uploader: Uploader = place.replacementName ? new UploadReplacementPlace(chtApi) : new UploadNewPlace(chtApi);
    const payload = place.asChtPayload();
    await Config.eCHISMutate(payload, chtApi, !!place.replacementName);

    if (!place.creationDetails.contactId) {
      const contactId = await uploader.handleContact(payload);
      place.creationDetails.contactId = contactId;
    }
    
    if (!place.creationDetails.placeId) {
      const placeId = await uploader.handlePlacePayload(place, payload);
      place.creationDetails.placeId = placeId;
    }
    
    await uploader.linkContactAndPlace(place, place.creationDetails?.placeId);

    if (!place.creationDetails.contactId) {
      throw Error('creationDetails.contactId not set');
    }
    
    if (!place.creationDetails.username) {
      const userPayload = new UserPayload(place, place.creationDetails.placeId, place.creationDetails.contactId);
      const { username, password } = await tryCreateUser(userPayload, chtApi);
      place.creationDetails.username = username;
      place.creationDetails.password = password;
    }
    
    console.log(`successfully created ${JSON.stringify(place.creationDetails)}`);
    return place.creationDetails;
  };

  public eventedSessionStateChange(sessionCache: SessionCache, state: SessionCacheUploadState) {
    sessionCache.state = state; 
    this.emit('session_state_change', state);     
  }

  private eventedPlaceStateChange = (subject: Place | Place[], state: PlaceUploadState) => {
    if (Array.isArray(subject)) {
      subject.forEach(place => place.state = state);
    } else {
      subject.state = state;
    }

    this.emit('places_state_change', state);
  };
};

async function tryCreateUser (userPayload: UserPayload, chtApi: ChtApi): Promise<{ username: string; password: string }> {
  for (let retryCount = 0; retryCount < 5; ++retryCount) {
    try {
      await chtApi.createUser(userPayload);
      return userPayload;
    } catch (err: any) {
      console.error("createUser retry because", err.response?.data);
      
      if (err?.response?.status !== 400) {
        throw err;
      }

      const msg = err.response?.data?.error?.message || err.response?.data;
      if (msg?.includes('already taken')) {
        userPayload.makeUsernameMoreComplex();
        continue;
      }
      
      if (msg?.includes('password')) { // password too easy to guess
        userPayload.regeneratePassword();
        continue;
      }
      
      throw err;
    }
  }

  throw new Error("could not create user " + userPayload.contact);
};
