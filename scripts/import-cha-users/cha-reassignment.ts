import _ from 'lodash';
import { ChtApi } from '../../src/lib/cht-api';
import Place from '../../src/services/place';
import { MultiplaceUsers, PlaceReassignment } from '../../src/lib/multiplace-users';
import PrimaryContactDirectory from './primary-contact-directory';

export default class ChaReassignment {
  private readonly chtApi: ChtApi;

  constructor(chtApi: ChtApi) {
    this.chtApi = chtApi;
  }

  public async reassignUsersFromPlaces(places: Place[], usernames: PrimaryContactDirectory) {
    const reassignmentPromises = places.map(place => this.toReassignments(place, usernames));
    const reassignments = await Promise.all(reassignmentPromises);
    const filteredReassignments = _.flatten(reassignments).filter(Boolean) as PlaceReassignment[];

    await MultiplaceUsers.reassignPlaces(filteredReassignments, this.chtApi);
  }

  private async toReassignments(place: Place, usernames: PrimaryContactDirectory): Promise<PlaceReassignment[] | undefined> {
    const placeName = place.resolvedHierarchy[0]?.name.formatted;
    const placeId = place.resolvedHierarchy[0]?.id;
    const userInfos = await usernames.getUsersAtPlaceWithPC(place);
    
    if (!placeId) {
      throw Error('no placeId');
    }
      
    if (!userInfos?.length) {
      throw Error(`Cannot reassign. No username for ${placeName}`);
    }

    console.log(`Reassigning: "${placeName}" (${placeId}) to user "${userInfos.map(info => info.username)}"`);
    return userInfos
      .map(userInfo => ({
        placeId,
        toUsername: userInfo.username,
        deactivate: false,
      }));
  }
}

