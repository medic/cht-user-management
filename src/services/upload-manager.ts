import EventEmitter from 'events';

import * as RetryLogic from '../lib/retry-logic';
import { ChtApi, CreatedPlaceResult, PlacePayload } from '../lib/cht-api';
import { Config } from '../config';
import Place, { PlaceUploadState } from './place';
import RemotePlaceCache from '../lib/remote-place-cache';
import { UploadNewPlace } from './upload.new';
import { UploadReplacementWithDeletion } from './upload.replacement';
import { UploadReplacementWithDeactivation } from './upload.deactivate';
import { UserPayload } from './user-payload';

const UPLOAD_BATCH_SIZE = 15;

export interface Uploader {
   handleContact (payload: PlacePayload): Promise<string | undefined>;
   handlePlacePayload (place: Place, payload: PlacePayload) : Promise<CreatedPlaceResult>;
}

export class UploadManager extends EventEmitter {
  doUpload = async (places: Place[], chtApi: ChtApi, ignoreWarnings: boolean = false) => {
    const placesNeedingUpload = places.filter(p => !p.isCreated && !p.hasValidationErrors && (ignoreWarnings || !p.warnings.length));
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
    this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGRESS);

    try {
      const uploader: Uploader = pickUploader(place, chtApi);
      const payload = place.asChtPayload(chtApi.chtSession.username);
      await Config.mutate(payload, chtApi, place.isReplacement);

      if (!place.creationDetails.contactId) {
        const contactId = await uploader.handleContact(payload);
        place.creationDetails.contactId = contactId;
      }

      if (!place.creationDetails.placeId) {
        const placeResult = await uploader.handlePlacePayload(place, payload);
        place.creationDetails.placeId = placeResult.placeId;
        place.creationDetails.contactId ||= placeResult.contactId;
      }

      if (!place.creationDetails.contactId) {
        throw Error('creationDetails.contactId not set');
      }

      if (!place.creationDetails.username) {
        const userPayload = new UserPayload(place, place.creationDetails.placeId, place.creationDetails.contactId);
        const { username, password } = await RetryLogic.createUserWithRetries(userPayload, chtApi);
        place.creationDetails.username = username;
        place.creationDetails.password = password;
      }

      RemotePlaceCache.add(place, chtApi);
      delete place.uploadError;

      console.log(`successfully created ${JSON.stringify(place.creationDetails)}`);
      this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
    } catch (err: any) {
      const errorDetails = getErrorDetails(err);
      console.log('error when creating user', errorDetails);
      place.uploadError = errorDetails;
      this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
    }
  }

  public triggerRefresh(place_id: string) {
    this.emit('refresh_table_row', place_id);
  }

  private eventedPlaceStateChange = (subject: Place | Place[], state: PlaceUploadState) => {
    if (!Array.isArray(subject)) {
      subject = [subject];
    }
    subject.forEach(place => {
      place.state = state;
      this.triggerRefresh(place.id);
    });
  };
}

function getErrorDetails(err: any) {
  if (typeof err.response?.data === 'string') {
    return err.response.data;
  }

  if (err.response?.data?.error) {
    return JSON.stringify(err.response.data.error);
  }
  
  return err.toString();
}

function pickUploader(place: Place, chtApi: ChtApi): Uploader {
  if (!place.hierarchyProperties.replacement.original) {
    return new UploadNewPlace(chtApi);
  }

  return place.type.deactivate_users_on_replace ? 
    new UploadReplacementWithDeactivation(chtApi) :
    new UploadReplacementWithDeletion(chtApi);
}

