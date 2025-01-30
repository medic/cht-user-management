import _ from 'lodash';

import { ChtApi } from '../../src/lib/cht-api';
import Place from '../../src/services/place';
import { MultiplaceUsers, PlaceReassignment } from '../../src/lib/multiplace-users';
import UsernameDictionary from './cha-usernames';

export default async function reassignUsersFromPlaces(places: Place[], usernames: UsernameDictionary, chtApi: ChtApi) {
  const reassignments = places
    .map(place => toReassignments(place, usernames))
    .filter(Boolean) as PlaceReassignment[];
  
  await MultiplaceUsers.reassignPlaces(reassignments, chtApi);
};

function toReassignments(place: Place, usernames: UsernameDictionary): PlaceReassignment | undefined {
  const placeName = place.resolvedHierarchy[0]?.name.formatted;
  const placeId = place.resolvedHierarchy[0]?.id;
  const toUsername = usernames.getUsername(place);
  
  if (!placeId) {
    throw Error('no placeId');
  }
    
  if (!toUsername) {
    throw Error(`Cannot reassign. No username for ${placeName}`);
  }

  console.log(`Reassigning: "${placeName}" (${placeId}) to user "${toUsername}"`);
  return {
    placeId,
    toUsername,
    deactivate: false,
  };
}
