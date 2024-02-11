import EventEmitter from 'events';

import axiosRetryConfig from '../lib/axios-retry-config';
import { ChtApi, PlacePayload } from '../lib/cht-api';
import { Config } from '../config';
import Place, { PlaceUploadState } from './place';
import RemotePlaceCache from '../lib/remote-place-cache';
import SessionCache, { SessionCacheUploadState } from './session-cache';
import { UploadNewPlace } from './upload.new';
import { UploadReplacementPlace } from './upload.replacement';
import { UserPayload } from './user-payload';

const UPLOAD_BATCH_SIZE = 10;
const RETRY_COUNT = 5;

export interface Uploader {
   handleContact (payload: PlacePayload): Promise<string | undefined>;
   handlePlacePayload (place: Place, payload: PlacePayload) : Promise<string>;
   linkContactAndPlace (place: Place, placeId: string): Promise<void>;
}

export class UploadManager extends EventEmitter {
  doUpload = async (places: Place[], chtApi: ChtApi) => {
    const placesNeedingUpload = places.filter(p => !p.isCreated && Object.keys(p.validationErrors as any).length === 0);
    this.eventedPlaceStateChange(placesNeedingUpload, PlaceUploadState.SCHEDULED);

    const independants = placesNeedingUpload.filter(p => !p.isDependant);
    const dependants = placesNeedingUpload.filter(p => p.isDependant);
    await this.uploadPlacesInBatches(independants, chtApi);
    await this.uploadPlacesInBatches(dependants, chtApi);
  };

  private async uploadPlacesInBatches(places: Place[], chtApi: ChtApi) {
    for (let batchStartIndex = 0; batchStartIndex < places.length; batchStartIndex += UPLOAD_BATCH_SIZE) {
      const batchEndIndex = Math.min(batchStartIndex + UPLOAD_BATCH_SIZE, places.length);
      const batch = places.slice(batchStartIndex, batchEndIndex);
      await Promise.all(batch.map(place => this.uploadSinglePlace(place, chtApi)));
    }
  }

  private async uploadSinglePlace(place: Place, chtApi: ChtApi) {
    this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGESS);

    try {
      const uploader: Uploader = place.hierarchyProperties.replacement ? new UploadReplacementPlace(chtApi) : new UploadNewPlace(chtApi);
      const payload = place.asChtPayload(chtApi.chtSession.username);
      await Config.mutate(payload, chtApi, !!place.properties.replacement);

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

      await RemotePlaceCache.add(place, chtApi);
      delete place.uploadError;

      console.log(`successfully created ${JSON.stringify(place.creationDetails)}`);
      this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
    } catch (err: any) {
      const errorDetails = err.response?.data ? JSON.stringify(err.response?.data) : err.toString();
      console.log('error when creating user', errorDetails);
      place.uploadError = errorDetails;
      this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
    }
  }

  public refresh(sessionCache: SessionCache) {
    this.emit('session_state_change', sessionCache.state);
    this.emit('places_state_change', PlaceUploadState.PENDING);
  }

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

async function tryCreateUser (userPayload: UserPayload, chtApi: ChtApi): Promise<{ username: string; password: string }> {
  for (let retryCount = 0; retryCount < RETRY_COUNT; ++retryCount) {
    try {
      await chtApi.createUser(userPayload);
      return userPayload;
    } catch (err: any) {      
      if (axiosRetryConfig.retryCondition(err)) {
        continue;
      }
      
      if (err.response?.status !== 400) {
        throw err;
      }

      const translationKey = err.response?.data?.error?.translationKey;
      console.error('createUser retry because', translationKey);
      if (translationKey === 'username.taken') {
        userPayload.makeUsernameMoreComplex();
        continue;
      }

      const RETRY_PASSWORD_TRANSLATIONS = ['password.length.minimum', 'password.weak'];
      if (RETRY_PASSWORD_TRANSLATIONS.includes(translationKey)) {
        userPayload.regeneratePassword();
        continue;
      }

      throw err;
    }
  }

  throw new Error('could not create user ' + userPayload.contact);
}
