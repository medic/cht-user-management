import EventEmitter from 'events';

import * as RetryLogic from '../lib/retry-logic';
import { ChtApi, CouchDoc, CreatedPlaceResult, PlacePayload, UserInfo } from '../lib/cht-api';
import { Config } from '../config';
import Place, { PlaceUploadState, UserCreationDetails } from './place';
import RemotePlaceCache from '../lib/remote-place-cache';
import { UploadNewPlace } from './upload.new';
import { UploadReplacementWithDeletion } from './upload.replacement';
import { UploadReplacementWithDeactivation } from './upload.deactivate';
import { UserPayload } from './user-payload';
import _ from 'lodash';
import { UploadLogRecord, UploadLogger } from './upload-log';
import ChtSession from '../lib/cht-session';

const UPLOAD_BATCH_SIZE = 15;

export interface Uploader {
  handleContact(payload: PlacePayload): Promise<string | undefined>;
  handlePlacePayload(place: Place, payload: PlacePayload): Promise<CreatedPlaceResult>;
}

export class UploadManager extends EventEmitter {

  private readonly uploadLogger;
  constructor(uploadLogger: UploadLogger) {
    super();
    this.uploadLogger = uploadLogger;
  }

  getLog = async (session: ChtSession): Promise<UploadLogRecord[]> => {
    return await this.uploadLogger.get(session);
  };

  doUpload = async (places: Place[], chtApi: ChtApi, ignoreWarnings: boolean = false) => {
    const validPlaces = places.filter(p => {
      return !p.hasValidationErrors && (ignoreWarnings || !p.warnings.length);
    });
    const placesNeedingUpload = validPlaces.filter(p => !p.isCreated);
    this.eventedPlaceStateChange(placesNeedingUpload, PlaceUploadState.SCHEDULED);

    const independants = placesNeedingUpload.filter(p => !p.isDependant && !p.hasSharedUser);
    const dependants = placesNeedingUpload.filter(p => p.isDependant && !p.hasSharedUser);
    const sharedUserPlaces = validPlaces.filter(p => p.hasSharedUser);

    const batch = (new Date()).getTime();
    await this.uploadPlacesInBatches(independants, chtApi, batch);
    await this.uploadPlacesInBatches(dependants, chtApi, batch);
    await this.uploadGrouped(sharedUserPlaces, chtApi, batch);
  };

  uploadGrouped = async (places: Place[], api: ChtApi, batchNo: number) => {
    const grouped = _.groupBy(places, place => place.contact.id);
    const keys = Object.keys(grouped);
    for (let i = 0; i < keys.length; i++) {
      const places = grouped[keys[i]];
      let creationDetails = places.find(p => !!p.creationDetails.username)?.creationDetails;
      if (!creationDetails) {
        await this.uploadSinglePlace(places[0], api, batchNo);
        creationDetails = places[0].creationDetails;
      }
      await this.uploadGroup(creationDetails, places, api);
    }
  };

  reassign = async (contactId: string, user: UserInfo & { place: CouchDoc[] }, places: string[], api: ChtApi) => {
    try {
      places.forEach(p => {
        this.emit('refresh_place', { id: p, state: PlaceUploadState.IN_PROGRESS });
      });
      await api.updateUser({ username: user.username, place: [...user.place.map(d => d._id), ...places] });
      await this.updateContact(contactId, places, api);
    } catch (err: any) {
      places.forEach(p => {
        this.emit('refresh_place', { id: p, state: PlaceUploadState.FAILURE, err: err.response?.data?.error?.message ?? err.message });
      });
    }
  };

  private async updateContact(contactId: string, places: string[], api: ChtApi) {
    for (let i = 0; i < places.length; i++) {
      try {
        const place = await api.getDoc(places[i]);
        if (place.contact) {
          const contactId = place.contact._id ?? place.contact;
          const prevUser = await api.getUser(contactId) as UserInfo & { place: CouchDoc[] };
          if (prevUser) {
            const prevUserPlaces = prevUser.place.map(p => p._id).filter(id => id !== places[i]);
            if (prevUserPlaces.length > 0) {
              await api.updateUser({
                username: prevUser.username,
                place: prevUserPlaces
              });
            } else {
              await api.disableUser(prevUser.username);
              await api.deleteDoc(contactId);
            }
          }
        }
        place.contact = contactId;
        await api.setDoc(places[i], place);
        this.emit('refresh_place', { id: places[i], state: PlaceUploadState.SUCCESS });
      } catch (err: any) {
        this.emit('refresh_place', { id: places[i], state: PlaceUploadState.FAILURE, err: err.response?.data?.error?.message ?? err.message });
      }
    }
  }

  private async uploadPlacesInBatches(places: Place[], chtApi: ChtApi, batchNo: number) {
    for (let batchStartIndex = 0; batchStartIndex < places.length; batchStartIndex += UPLOAD_BATCH_SIZE) {
      const batchEndIndex = Math.min(batchStartIndex + UPLOAD_BATCH_SIZE, places.length);
      const batch = places.slice(batchStartIndex, batchEndIndex);
      await Promise.all(batch.map(place => this.uploadSinglePlace(place, chtApi, batchNo)));
    }
  }

  private async uploadSinglePlace(place: Place, chtApi: ChtApi, batchNo: number) {
    this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGRESS);

    try {
      const uploader: Uploader = pickUploader(place, chtApi);
      const payload = place.asChtPayload(chtApi.chtSession.username);
      await Config.mutate(payload, chtApi, place.isReplacement);

      if (!place.creationDetails.contactId) {
        const contactId = await uploader.handleContact(payload);
        place.creationDetails.contactId = contactId;
      }

      let placeResult;
      if (!place.creationDetails.placeId) {
        placeResult = await uploader.handlePlacePayload(place, payload);
        place.creationDetails.placeId = placeResult.placeId;
        place.creationDetails.contactId ||= placeResult.contactId;
      }

      if (!place.creationDetails.contactId) {
        throw Error('creationDetails.contactId not set');
      }

      if (!place.creationDetails.username) {
        const userPayload = new UserPayload(
          place,
          [place.creationDetails.placeId, ...(placeResult?.placeIds ?? [])],
          place.creationDetails.contactId
        );
        const { username, password } = await RetryLogic.createUserWithRetries(userPayload, chtApi);
        place.creationDetails.username = username;
        place.creationDetails.password = password;
      }

      RemotePlaceCache.add(place, chtApi);
      delete place.uploadError;
      await this.uploadLogger.log(chtApi.chtSession, batchNo, [place]);

      console.log(`successfully created ${JSON.stringify(place.creationDetails)}`);
      this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
    } catch (err: any) {
      const errorDetails = getErrorDetails(err);
      console.log('error when creating user', errorDetails);
      place.uploadError = errorDetails;
      this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
    }
  }

  private async uploadGroup(creationDetails: UserCreationDetails, places: Place[], api: ChtApi) {
    if (!creationDetails.username || !creationDetails.placeId) {
      throw new Error('creationDetails must not be empty');
    }
    const placeIds: { [key: string]: any } = { [creationDetails.placeId]: '' };
    for (const place of places) {
      if (place.creationDetails.placeId) {
        placeIds[place.id] = undefined;
        continue;
      }
      this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGRESS);

      try {
        const payload = place.asChtPayload(api.chtSession.username, creationDetails.contactId);
        await Config.mutate(payload, api, place.isReplacement);

        const result = await api.createPlace(payload);

        place.creationDetails.contactId = result.contactId;
        place.creationDetails.placeId = result.placeId;
        placeIds[result.placeId] = undefined;

      } catch (err) {
        const errorDetails = getErrorDetails(err);
        console.log('error when creating place', errorDetails);
        place.uploadError = errorDetails;
        this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
      }
    }

    try {
      await api.updateUser({ username: creationDetails.username, place: Object.keys(placeIds) });
      const created_at = new Date().getTime();

      places.forEach(place => {
        place.creationDetails.username = creationDetails.username;
        place.creationDetails.password = creationDetails.password;
        place.creationDetails.created_at = created_at;
        this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
      });

      this.emit('refresh_grouped', creationDetails.contactId);

    } catch (err) {
      const errorDetails = getErrorDetails(err);
      console.log('error when creating user', errorDetails);
      places.filter(p => !p.creationDetails.username).forEach(place => {
        place.uploadError = errorDetails;
        this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
      });
      this.emit('refresh_grouped', creationDetails.contactId);
    }

  }

  public triggerRefresh(place_id: string) {
    this.emit('refresh_table_row', place_id);
    this.emit('refresh_grouped');
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
    return err.response.data.error.message ?? JSON.stringify(err.response.data.error);
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

