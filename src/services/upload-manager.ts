import EventEmitter from 'events';

import * as RetryLogic from '../lib/retry-logic';
import { ChtApi, PlacePayload } from '../lib/cht-api';
import { Config } from '../config';
import Place, { PlaceUploadState } from './place';
import RemotePlaceCache from '../lib/remote-place-cache';
import { UploadNewPlace } from './upload.new';
import { UploadReplacementWithDeletion } from './upload.replacement';
import { UploadReplacementWithDeactivation } from './upload.deactivate';
import { generatePassword, makeUsernameMoreComplex, UserPayload } from './user-payload';
import { v4 as uuid } from 'uuid';
import { throws } from 'assert';

const CREATE_BATCH_SIZE = 256;
const UPLOAD_BATCH_SIZE = 15;

export interface Uploader {
   handleContact (payload: PlacePayload): Promise<string | undefined>;
   handlePlacePayload (place: Place, payload: PlacePayload) : Promise<string>;
   linkContactAndPlace (place: Place, placeId: string): Promise<void>;
}

type InsertResult = {
  id: string;
  ok: boolean;
  error?: {
    message: string;
  };
};

type PlaceInsertResult = {
  ok: boolean;
  place: string;
  contact: string;
};

export class UploadManager extends EventEmitter {
  doUpload = async (places: Place[], chtApi: ChtApi) => {
    const placesNeedingUpload = places.filter(p => !p.isCreated && !p.hasValidationErrors);
    this.eventedPlaceStateChange(placesNeedingUpload, PlaceUploadState.SCHEDULED);

    const independants = placesNeedingUpload.filter(p => !p.isDependant);
    const dependants = placesNeedingUpload.filter(p => p.isDependant);
    await this.uploadPlacesInBatches(independants, chtApi);
    await this.uploadPlacesInBatches(dependants, chtApi);
  };

  private async uploadPlacesInBatches(places: Place[], chtApi: ChtApi) {
    const newPlaces: Place[] = [];
    const replacements: Place[] = [];
    for (let place of places) {
      if (place.hierarchyProperties.replacement) {
        replacements.push(place);
      } else {
        newPlaces.push(place);
      }
    }
    for (let batchStartIndex = 0; batchStartIndex < newPlaces.length; batchStartIndex += CREATE_BATCH_SIZE) {
      const batchEndIndex = Math.min(batchStartIndex + CREATE_BATCH_SIZE, newPlaces.length);
      const batch = newPlaces.slice(batchStartIndex, batchEndIndex);
      await this.uploadBatch(batch, chtApi);
    }
    for (let batchStartIndex = 0; batchStartIndex < replacements.length; batchStartIndex += UPLOAD_BATCH_SIZE) {
      const batchEndIndex = Math.min(batchStartIndex + UPLOAD_BATCH_SIZE, replacements.length);
      const batch = replacements.slice(batchStartIndex, batchEndIndex);
      await this.replacePrimaryContact(batch, chtApi);
    }
  }
  
  private async uploadBatch(places: Place[], chtApi: ChtApi) {
    const placeInsertResults = await this.createPlaces(places, chtApi);
    const userPayloads: UserPayload[] = [];
    for (let [placeID, result] of placeInsertResults) {
      const place = places.find((p) => p.id === placeID);
      if (!place) {
        throw new Error('failed to find place');
      } 
      if (!result.ok) {
        console.log("error", result);
        this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
        continue;
      }
      place.creationDetails.placeId = result.place;
      place.creationDetails.contactId = result.contact;
      const userPayload = new UserPayload(place, result.place, result.contact);
      userPayloads.push(userPayload);
    }
    const failures = await this.createUsers(userPayloads, chtApi);
    for (let payload of userPayloads) {
      let place = places.find((p) => p.id === payload.place);
      if (!place) throw new Error("falied to find place");
      if (failures.includes(payload)) {
        this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
      } else {
        place.creationDetails.username = payload.username;
        place.creationDetails.password = payload.password;
        this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
      }
    }
  }

  private async createPlaces(places: Place[], chtApi: ChtApi): Promise<Map<string, PlaceInsertResult>> {
    const payloads: any[] = [];
    for (let i = 0; i < places.length; i++) {
      this.eventedPlaceStateChange(places[i], PlaceUploadState.IN_PROGRESS);
      let payload = places[i].asChtPayload(chtApi.chtSession.username);
      await Config.mutate(payload, chtApi, false);
      const parent = payload.parent;
      const contact = payload.contact;
      delete payload.contact;
      delete payload.parent;
      const contactID = uuid();
      payloads.push(
        {
          ...payload,
          contact: contactID,
          parent: { // not the full hierarchy
            _id: parent
          }
        },
        {
          ...contact,
          _id: contactID,
          parent: {
            _id: payload._id
          }
        }
      );
    }
    const results: InsertResult[] = await chtApi.bulkCreate(payloads);
    const resultMap = new Map<string, PlaceInsertResult>();
    for (let i = 0; i < results.length; i += 2) {
      resultMap.set(results[i].id, {
        ok: results[i].ok && results[i+1].ok,
        place: results[i].id,
        contact: results[i+1].id
      });
    }
    return resultMap;
  }
  
  private async replacePrimaryContact(places: Place[], chtApi: ChtApi) {
    
  }

  private async createUsers(userPayloads: UserPayload[], chtApi: ChtApi, retryCount: number = 0): Promise<UserPayload[]> {
    if (retryCount > 5) return userPayloads;
    if (retryCount > 0) {
      for (let i = 0; i < userPayloads.length; i++) {
        userPayloads[i].username = makeUsernameMoreComplex(
          userPayloads[i].username
        );
        userPayloads[i].password = generatePassword();
      }
    }
    const resps: any[] = await chtApi.createUsers(userPayloads);
    let failures: UserPayload[] = [];
    for (let i = 0; i < resps.length; i++) {
      if (resps[i].error) {
        failures.push(userPayloads[i]);
        continue;
      }
    }
    if (failures.length > 0) {
      retryCount+=1;
      failures = await this.createUsers(failures, chtApi, retryCount);
    }
    return failures;
  }

  private async uploadSinglePlace(place: Place, chtApi: ChtApi) {
    this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGRESS);

    try {
      const uploader: Uploader = pickUploader(place, chtApi);
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

      const createdPlaceId = place.creationDetails.placeId; // closure required for typescript
      await RetryLogic.retryOnUpdateConflict<void>(() => uploader.linkContactAndPlace(place, createdPlaceId));

      if (!place.creationDetails.contactId) {
        throw Error('creationDetails.contactId not set');
      }

      if (!place.creationDetails.username) {
        const userPayload = new UserPayload(place, place.creationDetails.placeId, place.creationDetails.contactId);
        const { username, password } = await RetryLogic.createUserWithRetries(userPayload, chtApi);
        place.creationDetails.username = username;
        place.creationDetails.password = password;
      }

      await RemotePlaceCache.add(place, chtApi);
      delete place.uploadError;

      console.log(`successfully created ${JSON.stringify(place.creationDetails)}`);
      this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
    } catch (err: any) {
      const errorDetails = err.response?.data?.error ? JSON.stringify(err.response.data.error) : err.toString();
      console.log('error when creating user', errorDetails);
      place.uploadError = errorDetails;
      this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
    }
  }

  public triggerRefresh(place_id: string | undefined) {
    if (place_id) {
      this.emit('refresh_table_row', place_id);
    } else {
      this.emit('refresh_table');
    }
  }

  private eventedPlaceStateChange = (subject: Place | Place[], state: PlaceUploadState) => {
    if (!Array.isArray(subject)) {
      subject = [subject];
    }
    
    if (subject.length > 1) {
      this.triggerRefresh(undefined);
      return;
    }

    subject.forEach(place => {
      place.state = state;
      this.triggerRefresh(place.id);
    });
  };
}

function pickUploader(place: Place, chtApi: ChtApi): Uploader {
  if (!place.hierarchyProperties.replacement) {
    return new UploadNewPlace(chtApi);
  }

  return place.type.deactivate_users_on_replace ? 
    new UploadReplacementWithDeactivation(chtApi) :
    new UploadReplacementWithDeletion(chtApi);
}

