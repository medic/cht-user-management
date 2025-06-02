import { ISupersetIntegration } from './superset-integration';
import Place, { UploadState, PlaceUploadState } from './place';
import _ from 'lodash';
import { getErrorDetails } from './upload-manager';

export class SupersetUploadManager {
  constructor(
    private readonly supersetIntegration: ISupersetIntegration,
    private readonly eventedUploadStateChange: (place: Place, system: 'cht' | 'superset', state: UploadState) => void,
    private readonly eventedPlaceStateChange: (place: Place | Place[], state: PlaceUploadState) => void
  ) {}

  async uploadGrouped(places: Place[]): Promise<void> {
    const grouped = _.groupBy(places, place => place.contact.id);
    const keys = Object.keys(grouped);
    for (let i = 0; i < keys.length; i++) {
      const group = grouped[keys[i]];
      const successfulPlaces = group.filter(
        p => p.chtUploadState === UploadState.SUCCESS && p.shouldUploadToSuperset()
      );
      if (successfulPlaces.length === group.length && successfulPlaces.length > 0) {
        try {
          await this.supersetIntegration.handleGroup(successfulPlaces);
          successfulPlaces.forEach(place => {
            this.eventedUploadStateChange(place, 'superset', UploadState.SUCCESS);
            this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
            delete place.uploadError;
          });
        } catch (err) {
          const errorDetails = getErrorDetails(err);
          successfulPlaces.forEach(place => {
            place.uploadError = errorDetails;
            this.eventedUploadStateChange(place, 'superset', UploadState.FAILURE);
            this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
          });
        }
      } else {
        console.log('Skipping Superset group integration due to CHT failures');
      }
    }
  }

  async uploadInBatches(places: Place[]): Promise<void> {
    const supersetPlaces = places.filter(
      p => p.chtUploadState === UploadState.SUCCESS && p.shouldUploadToSuperset()
    );
    for (const place of supersetPlaces) {
      await this.uploadSingle(place);
    }
  }

  async uploadSingle(place: Place): Promise<void> {
    try {
      await this.supersetIntegration.handlePlace(place);
      this.eventedUploadStateChange(place, 'superset', UploadState.SUCCESS);
      this.eventedPlaceStateChange(place, PlaceUploadState.SUCCESS);
      delete place.uploadError;
    } catch (err) {
      const errorDetails = getErrorDetails(err);
      place.uploadError = errorDetails;
      this.eventedUploadStateChange(place, 'superset', UploadState.FAILURE);
      this.eventedPlaceStateChange(place, PlaceUploadState.FAILURE);
    }
  }
}
