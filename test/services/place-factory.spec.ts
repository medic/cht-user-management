import _ from 'lodash';
import fs from 'fs';
import { expect } from 'chai';
import sinon from 'sinon';

import { expectInvalidProperties, mockChtSession, mockParentPlace, mockProperty, mockValidContactType } from '../mocks';
import { Config } from '../../src/config';
import Place from '../../src/services/place';
import PlaceFactory from '../../src/services/place-factory';
import { RemotePlace } from '../../src/lib/cht-api';
import RemotePlaceCache from '../../src/lib/remote-place-cache';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';
import SessionCache from '../../src/services/session-cache';

describe('services/place-factory.ts', () => {
  beforeEach(() => {
    RemotePlaceCache.clear({});
  });

  it('name conflict at local yields invalid', async () => {
    const { parentContactType, sessionCache, fakeFormData, chtApi } = mockScenario();
    const parent1 = mockParentPlace(parentContactType, fakeFormData.hierarchy_PARENT);
    const parent2 = mockParentPlace(parentContactType, fakeFormData.hierarchy_PARENT);
    sessionCache.savePlaces(parent1, parent2);

    const place: Place = await PlaceFactory.createOne(fakeFormData, parentContactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'multiple');
  });

  it('name conflict at remote yields invalid', async () => {
    const { remotePlace, sessionCache, fakeFormData, contactType, chtApi } = mockScenario();
    const secondParent = _.cloneDeep(remotePlace);
    secondParent.id = 'second-id';
    chtApi.getPlacesWithType.resolves([remotePlace, secondParent]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'multiple');
  });

  it('parent match requiring local fuzz', async () => {
    const { sessionCache, fakeFormData, contactType, parentContactType, chtApi } = mockScenario();

    const chu = new Place(parentContactType);
    chu.properties.name = 'Demesi';
    sessionCache.savePlaces(chu);

    fakeFormData.hierarchy_PARENT = 'Demesi ';

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq(chu.id);
    expect(place.hierarchyProperties.PARENT).to.eq('Demesi');
  });

  it('bulk upload fuzzed parent matching', async () => {
    const { remotePlace, sessionCache, fakeFormData, chtApi } = mockScenario();

    const nameValidator = ['Cu', 'Community Health Unit'];
    const contactType = mockValidContactType('string', undefined);
    contactType.hierarchy[0] = {
      ...mockProperty('name', nameValidator, 'PARENT'),
      level: 1,
      contact_type: 'parent',
    };

    remotePlace.name = 'Cheplanget Cu';
    fakeFormData.hierarchy_PARENT = 'Cheplanget Community Health Unit';

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
  });

  it('simple replacement', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    const toReplace: RemotePlace = {
      id: 'id-replace',
      name: 'to-replace',
      lineage: [remotePlace.id],
      type: 'remote',
    };

    chtApi.getPlacesWithType
      .resolves([remotePlace])
      .onSecondCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('invalid when name doesnt match any remote place', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    remotePlace.name = 'foobar';
    
    chtApi.getPlacesWithType
      .resolves([remotePlace])
      .onSecondCall().resolves([]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'Cannot find');
  });

  it('simple eCHIS csv', async () => {
    const { remotePlace, sessionCache, chtApi } = mockScenario();

    const toReplace: RemotePlace = {
      id: 'id-replace',
      name: 'bob',
      lineage: [remotePlace.id],
      type: 'remote',
    };

    remotePlace.name = 'Chepalungu CHU';

    chtApi.getPlacesWithType
      .resolves([remotePlace])
      .onSecondCall().resolves([toReplace]);

    const singleCsvBuffer = fs.readFileSync('./test/single.csv');
    const chpType = Config.getContactType('d_community_health_volunteer_area');
    
    const places: Place[] = await PlaceFactory.createBulk(singleCsvBuffer, chpType, sessionCache, chtApi);
    expect(places).to.have.property('length', 1);

    const [successfulPlace] = places;
    expect(successfulPlace).to.deep.nested.include({
      'contact.properties.name': 'Sally',
      'contact.properties.phone': '0712 345678',
      creationDetails: {},
      'properties.name': 'Sally Area',
      'hierarchyProperties.CHU': 'Chepalungu',
      resolvedHierarchy: [
        {
          id: 'id-replace',
          name: 'bob',
          lineage: ['parent-id'],
          type: 'remote',
        },
        {
          id: 'parent-id',
          name: 'Chepalungu CHU',
          type: 'remote',
          lineage: [],
        },
      ],
      validationErrors: {},
    });
  });

  it('ambiguous parent resolves if only one has the replacement', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const toReplace: RemotePlace = {
      id: 'id-replace',
      name: 'to-replace',
      lineage: [remotePlace.id],
      type: 'remote',
    };
    fakeFormData.hierarchy_replacement = toReplace.name;

    const ambiguous = {
      ...remotePlace,
      id: 'id-parent-ambiguous',
    };

    chtApi.getPlacesWithType
      .resolves([remotePlace, ambiguous])
      .onSecondCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('ambiguous greatgrandparent disambiguated by parent', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();

    const greatParent: RemotePlace = {
      id: 'id-great-grandparent',
      name: 'great-grand-parent',
      type: 'remote',
      lineage: [],
    };
    contactType.hierarchy[1] = {
      ...mockProperty('name', undefined, 'GREATGRANDPARENT'),
      level: 3,
      contact_type: 'greatgrandparent',
      required: false,
    };
    fakeFormData.hierarchy_GREATGRANDPARENT = greatParent.name;
    remotePlace.lineage[1] = greatParent.id;

    const ambiguous = {
      ...greatParent,
      id: 'ambiguous-great-grandparent',
    };

    chtApi.getPlacesWithType
      .resolves([greatParent, ambiguous])
      .onSecondCall().resolves([remotePlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[3]?.id).to.eq(greatParent.id);
    expect(place.resolvedHierarchy[1]?.id).to.eq(remotePlace.id);
  });

  it('ambiguous parent disambiguated by grandparent', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: RemotePlace = {
      id: 'id-grandparent',
      name: 'grand-parent',
      type: 'remote',
      lineage: [],
    };
    fakeFormData.hierarchy_GRANDPARENT = grandParent.name;
    
    const ambiguous = {
      ...remotePlace,
      id: 'id-ambiguous',
    };
    remotePlace.lineage = [grandParent.id];
    ambiguous.lineage = ['not-grandpa'];

    chtApi.getPlacesWithType
      .resolves([grandParent])
      .onSecondCall().resolves([remotePlace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy).to.deep.eq([undefined, remotePlace, grandParent]);
  });

  it('#91 - no result for optional level in hierarchy causes validation error', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: RemotePlace = {
      id: 'id-grandparent',
      name: 'grand-parent',
      type: 'remote',
      lineage: [],
    };
    remotePlace.lineage = [grandParent.id];
    fakeFormData.hierarchy_GRANDPARENT = 'no match';

    chtApi.getPlacesWithType
      .resolves([grandParent])
      .onSecondCall().resolves([remotePlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.resolvedHierarchy[2]).to.eq(RemotePlaceResolver.NoResult);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT', 'hierarchy_GRANDPARENT'], 'Cannot find');
  });

  it('hierarchy resolution can be resolved by editing to blank', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: RemotePlace = {
      id: 'id-grandparent',
      name: 'grand-parent',
      type: 'remote',
      lineage: [],
    };
    remotePlace.lineage = [grandParent.id];
    fakeFormData.hierarchy_GRANDPARENT = 'no match';

    chtApi.getPlacesWithType
      .resolves([grandParent])
      .onSecondCall().resolves([remotePlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT', 'hierarchy_GRANDPARENT'], 'Cannot find');

    fakeFormData.hierarchy_GRANDPARENT = '';
    const edited = await PlaceFactory.editOne(place.id, fakeFormData, sessionCache, chtApi);
    expect(edited.validationErrors).to.be.empty;
  });

  it('ambiguous parent disambiguated by greatgrandparent', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const greatParent: RemotePlace = {
      id: 'id-great-grandparent',
      name: 'great-grand-parent',
      type: 'remote',
      lineage: [],
    };
    contactType.hierarchy[1] = {
      ...mockProperty('name', undefined, 'GREATGRANDPARENT'),
      level: 3,
      contact_type: 'greatgrandparent',
      required: false,
    };
    fakeFormData.hierarchy_GREATGRANDPARENT = greatParent.name;
    
    const ambiguous = {
      ...remotePlace,
      id: 'id-ambiguous',
    };
    remotePlace.lineage = ['no-matter', greatParent.id];
    ambiguous.lineage = ['not-grandpa', 'not-grandpa'];

    chtApi.getPlacesWithType
      .resolves([greatParent])
      .onSecondCall().resolves([remotePlace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy).to.deep.eq([undefined, remotePlace, undefined, greatParent]);
  });

  it('ambiguous place under single parent is invalid', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    const toReplace: RemotePlace = {
      id: 'id-replace',
      name: 'to-replace',
      lineage: [remotePlace.id],
      type: 'remote',
    };
    const ambiguous = {
      ...toReplace,
      id: 'id-replace-ambiguous',
      parentId: remotePlace.id,
    };

    chtApi.getPlacesWithType
      .resolves([remotePlace])
      .onSecondCall()
      .resolves([toReplace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(chtApi.getPlacesWithType.args).to.deep.eq([['parent'], ['contacttype-name']]);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'multiple');
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('multiple');
  });

  it('replacement place not under parent is invalid', async () => {
    const { remotePlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const toReplace: RemotePlace = {
      id: 'id-replace',
      name: 'to-replace',
      lineage: ['different-parent'],
      type: 'remote',
    };
    fakeFormData.hierarchy_replacement = toReplace.name;
    chtApi.getPlacesWithType
      .resolves([remotePlace])
      .onSecondCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'Cannot find');
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]).to.eq(RemotePlaceResolver.NoResult);
  });
  
  it('place not under users facility is invalid', async () => {
    const { remotePlace, sessionCache, contactType, parentContactType, fakeFormData, chtApi } = mockScenario();
    const parent1 = mockParentPlace(parentContactType, fakeFormData.hierarchy_PARENT);
    chtApi.getPlacesWithType.resolves([remotePlace]);
    chtApi.chtSession = mockChtSession('other');
    fakeFormData.hierarchy_PARENT = parent1.name;

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'Cannot find');
  });
});

function mockScenario() {
  const contactType = mockValidContactType('string', undefined);
  const remotePlace: RemotePlace = {
    id: 'parent-id',
    name: 'parent-name',
    type: 'remote',
    lineage: [],
  };
  const sessionCache = new SessionCache();
  const chtApi = {
    chtSession: mockChtSession(),
    getPlacesWithType: sinon.stub().resolves([remotePlace]),
    createPlace: sinon.stub().resolves('created-place-id'),
    updateContactParent: sinon.stub().resolves('created-contact-id'),
    createUser: sinon.stub().resolves(),
  };
  const fakeFormData:any = {
    place_name: 'place',
    place_prop: 'foo',
    hierarchy_PARENT: remotePlace.name,
    contact_name: 'contact',
  };
  const parentContactType = mockValidContactType('string', undefined);
  parentContactType.name = contactType.hierarchy[0].contact_type;

  return { 
    remotePlace,
    sessionCache,
    fakeFormData,
    parentContactType,
    contactType,
    chtApi
  };
}

