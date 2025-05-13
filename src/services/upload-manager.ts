import EventEmitter from 'events';

import * as RetryLogic from '../lib/retry-logic';
import { ChtApi, CouchDoc, CreatedPlaceResult, PlacePayload, UserInfo } from '../lib/cht-api';
import { Config } from '../config';
import Place, { PlaceUploadState, UserCreationDetails, UploadState } from './place';
import RemotePlaceCache from '../lib/remote-place-cache';
import { UploadNewPlace } from './upload.new';
import { UploadReplacementWithDeletion } from './upload.replacement';
import { UploadReplacementWithDeactivation } from './upload.deactivate';
import { UserPayload } from './user-payload';
import { SupersetApi } from '../lib/superset-api';
import { UploadSuperset } from './upload-superset';
import _ from 'lodash';

const UPLOAD_BATCH_SIZE = 15;

export interface Uploader {
   handleContact (payload: PlacePayload): Promise<string | undefined>;
   handlePlacePayload (place: Place, payload: PlacePayload) : Promise<CreatedPlaceResult>;
}

export class UploadManager extends EventEmitter {
  doUpload = async (places: Place[], chtApi: ChtApi, supersetApi: SupersetApi, ignoreWarnings: boolean = false) => {
    const validPlaces = places.filter(p => {
      return !p.hasValidationErrors && (ignoreWarnings || !p.warnings.length);
    });
    const placesNeedingUpload = validPlaces.filter(p => !p.isCreated);
    this.eventedPlaceStateChange(placesNeedingUpload, PlaceUploadState.SCHEDULED);

    const independants = placesNeedingUpload.filter(p => !p.isDependant && !p.hasSharedUser);
    const dependants = placesNeedingUpload.filter(p => p.isDependant && !p.hasSharedUser);
    const sharedUserPlaces = validPlaces.filter(p => p.hasSharedUser);

    await this.uploadPlacesInBatches(independants, chtApi, supersetApi);
    await this.uploadPlacesInBatches(dependants, chtApi, supersetApi);
    await this.uploadGrouped(sharedUserPlaces, chtApi, supersetApi);
  };

  uploadGrouped =  async (places: Place[], api: ChtApi, supersetApi: SupersetApi) => {
    const grouped = _.groupBy(places, place => place.contact.id);
    const keys = Object.keys(grouped);
    for (let i = 0; i < keys.length; i++) {
      const places = grouped[keys[i]];
      let creationDetails = places.find(p => !!p.creationDetails.username)?.creationDetails;
      if (!creationDetails) {
        await this.uploadSinglePlace(places[0], api, supersetApi);
        creationDetails = places[0].creationDetails;
      }
      await this.uploadGroup(creationDetails, places, api, supersetApi);
    }
  };
  
  reassign = async (contactId: string, user: UserInfo & { place: CouchDoc[] }, places: string[], api: ChtApi) => {
    try {
      places.forEach(p => {  
        this.emit('refresh_place', { id: p, state: PlaceUploadState.IN_PROGRESS });
      });
      await api.updateUser({ username: user.username, place: [...user.place.map(d => d._id), ...places ] });
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
          const prevUser = await api.getUser(contactId) as UserInfo & {place: CouchDoc[]};
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

  
  private async uploadPlacesInBatches(places: Place[], chtApi: ChtApi, supersetApi: SupersetApi) {
    for (let batchStartIndex = 0; batchStartIndex < places.length; batchStartIndex += UPLOAD_BATCH_SIZE) {
      const batchEndIndex = Math.min(batchStartIndex + UPLOAD_BATCH_SIZE, places.length);
      const batch = places.slice(batchStartIndex, batchEndIndex);
      await Promise.all(batch.map(place => this.uploadSinglePlace(place, chtApi, supersetApi)));
    }
  }

  private async uploadSinglePlace(place: Place, chtApi: ChtApi, supersetApi: SupersetApi) {
    this.eventedPlaceStateChange(place, PlaceUploadState.IN_PROGRESS);
  
    // Handle CHT upload if the upload has not been attempted or is pending or failed
    if (place.isChtUploadIncomplete()) {
      try {
        this.eventedUploadStateChange(place, 'cht', UploadState.PENDING);
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
  
        this.eventedUploadStateChange(place, 'cht', UploadState.SUCCESS);
        await RemotePlaceCache.add(place, chtApi);
        console.log(`Successfully created CHT user for place ${place.id}`);
      } catch (err: any) {
        const errorDetails = getErrorDetails(err);
        console.log('Error during CHT user creation', errorDetails);
        place.uploadError = errorDetails;
        this.eventedUploadStateChange(place, 'cht', UploadState.FAILURE);
      }
    }
  
    // Handle Superset upload if not been attempted or is pending or failed and if Superset upload is required
    if (place.chtUploadState === UploadState.SUCCESS && place.shouldUploadToSuperset() && place.isSupersetUploadIncomplete()) {
      try {
        this.eventedUploadStateChange(place, 'superset', UploadState.PENDING);
        const uploadSuperset = new UploadSuperset(supersetApi);
        const { username, password } = await uploadSuperset.handlePlace(place);

        place.creationDetails.username = username;
        place.creationDetails.password = password;
        this.eventedUploadStateChange(place, 'superset', UploadState.SUCCESS);
        await RemotePlaceCache.add(place, chtApi);
        console.log(`Successfully created Superset user for place ${place.id}`);
      } catch (err: any) {
        const errorDetails = getErrorDetails(err);
        console.log('Error during Superset user creation', errorDetails);
        this.eventedUploadStateChange(place, 'superset', UploadState.FAILURE);
        place.uploadError = errorDetails;
      }
    }
  
    // Determine final upload state
    if (place.isCreated) {
      RemotePlaceCache.add(place, chtApi);
      delete place.uploadError;

      console.log(`successfully created ${JSON.stringify(place.creationDetails)}`);
      this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
    } else {
      this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
    }
  }

  private async uploadGroup(creationDetails: UserCreationDetails, places: Place[], api: ChtApi, supersetApi: SupersetApi) {
    if (!creationDetails.username || !creationDetails.placeId) {
      throw new Error('creationDetails must not be empty');
    }
    const placeIds: {[key:string]: any} = { [creationDetails.placeId]: '' };
    
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
        this.eventedUploadStateChange(place, 'cht', UploadState.SUCCESS);
      } catch (err) {
        const errorDetails = getErrorDetails(err);
        console.log('error when creating place', errorDetails);
        place.uploadError = errorDetails;
        this.eventedUploadStateChange(place, 'cht', UploadState.FAILURE);
        this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
      }
    }
  
    try {
      // Update CHT user with all places
      await api.updateUser({ username: creationDetails.username, place: Object.keys(placeIds)});
      const created_at = new Date().getTime();

      // Update creation details for all places
      places.forEach(place => {
        place.creationDetails.username = creationDetails.username;
        place.creationDetails.password = creationDetails.password;
        place.creationDetails.created_at = created_at;
      });

      // Handle Superset for all successfully created places
      const successfulPlaces = places.filter(
        place => place.chtUploadState === UploadState.SUCCESS && 
        place.shouldUploadToSuperset()
      );

      if (successfulPlaces.length > 0) {
        try {
          const uploadSuperset = new UploadSuperset(supersetApi);
          await uploadSuperset.handleGroup(successfulPlaces);
          
          // Update all places with success state
          successfulPlaces.forEach(place => {
            this.eventedUploadStateChange(place, 'superset', UploadState.SUCCESS);
            this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
          });
          
          console.log(`Successfully created Superset roles and assigned to user ${creationDetails.username}`);
        } catch (err: any) {
          const errorDetails = getErrorDetails(err);
          console.log('Error during Superset group creation', errorDetails);
          successfulPlaces.forEach(place => {
            this.eventedUploadStateChange(place, 'superset', UploadState.FAILURE);
            place.uploadError = errorDetails;
            this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
          });
        }
      } else {
        // If no Superset upload needed, mark all places as success
        places
          .forEach(place => {
            if (place.chtUploadState === UploadState.SUCCESS) {
              this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
            }
          });
      }

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

  private eventedUploadStateChange = (place: Place, system: 'cht' | 'superset', state: UploadState) => {
    if (system === 'cht') {
      place.chtUploadState = state;
    } else {
      place.supersetUploadState = state;
    }

    this.triggerRefresh(place.id);
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
