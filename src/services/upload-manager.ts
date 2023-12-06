import EventEmitter from "events";
import { ChtApi } from "../lib/cht-api";

import Place, { PlaceUploadState, UserCreationDetails } from "./place";
import { UserPayload } from "./user-payload";
import SessionCache, { SessionCacheUploadState } from "./session-cache";

export type JobState = {
  placeId: string;
  state: PlaceUploadState;
};

export class UploadManager extends EventEmitter {
  doUpload = async (places: Place[], chtApi: ChtApi) => {
    const placesNeedingUpload = places.filter(p => !p.isCreated && p.invalidProperties?.length === 0);
    this.eventedPlaceStateChange(placesNeedingUpload, PlaceUploadState.SCHEDULED);

    for (const place of placesNeedingUpload) {
      this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGESS);

      try {
        await this.uploadPlace(place, chtApi);
        this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
      } catch (err) {
        this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
      }
    }
  };

  private uploadPlace = async (place: Place, chtApi: ChtApi): Promise<UserCreationDetails> => {
    let placeId = place.creationDetails?.placeId;
    if (!placeId) {
      const placePayload = place.asChtPayload();
      placeId = await chtApi.createPlace(placePayload);
      place.creationDetails.placeId = placeId;
    }

    // why...we don't get a contact id when we create a place with a contact defined.
    // then the created contact doesn't get a parent assigned so we can't create a user for it
    let contactId = place.creationDetails.contactId; 
    if (!contactId) {
      contactId = await chtApi.getPlaceContactId(placeId);
      await chtApi.updateContactParent(contactId, placeId);
      place.creationDetails.contactId = contactId;
    }

    if (!place.creationDetails.username) {
      const userPayload = new UserPayload(place, placeId, contactId);
      const { username, password } = await this.tryCreateUser(userPayload, chtApi);
      place.creationDetails.username = username;
      place.creationDetails.password = password;
    }
    
    return place.creationDetails;
  };

  private tryCreateUser = async (userPayload: UserPayload, chtApi: ChtApi): Promise<{ username: string; password: string }> => {    
    for (let retryCount = 0; retryCount < 5; ++retryCount) {
      try {
        await chtApi.createUser(userPayload);
        return userPayload;
      } catch (err: any) {
        console.error("createUser retry because", err.response?.data);
        
        if (err?.response?.status !== 400) {
          throw err;
        }

        const msg = err.response?.data?.error?.message;
        if (msg.includes('already taken')) {
          userPayload.makeUsernameMoreComplex();
          continue;
        }
        
        if (msg.includes('password')) { // password too easy to guess
          userPayload.regeneratePassword();
          continue;
        }
        
          throw err;
      }
    }

    throw new Error("could not create user " + userPayload.contact);
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
}
