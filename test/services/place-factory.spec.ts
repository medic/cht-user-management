import _ from 'lodash';
import fs from 'fs';
import { expect } from 'chai';
import sinon from 'sinon';

import { ChtDoc, expectInvalidProperties, mockChtSession, mockParentPlace, mockProperty, mockValidContactType } from '../mocks';
import { Config } from '../../src/config';
import Place from '../../src/services/place';
import PlaceFactory from '../../src/services/place-factory';
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
    const { chtPlace, sessionCache, fakeFormData, contactType, chtApi } = mockScenario();
    const secondParent = _.cloneDeep(chtPlace);
    secondParent._id = 'second-id';
    chtApi.getPlacesWithType.resolves([chtPlace, secondParent]);

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
    const { chtPlace, sessionCache, fakeFormData, chtApi } = mockScenario();

    const nameValidator = ['Cu', 'Community Health Unit'];
    const contactType = mockValidContactType('string', undefined);
    contactType.hierarchy[0] = {
      ...mockProperty('name', nameValidator, 'PARENT'),
      level: 1,
      contact_type: 'parent',
    };

    chtPlace.name = 'Cheplanget Cu';
    fakeFormData.hierarchy_PARENT = 'Cheplanget Community Health Unit';

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
  });

  it('simple replacement', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: chtPlace._id },
    };

    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('invalid when name doesnt match any remote place', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    chtPlace.name = 'foobar';
    
    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall().resolves([]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'Cannot find');
  });

  it('simple eCHIS csv', async () => {
    const { chtPlace, sessionCache, chtApi } = mockScenario();

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'bob',
      parent: { _id: chtPlace._id },
    };

    chtPlace.name = 'Chepalungu CHU';

    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall().resolves([toReplace]);

    const singleCsvBuffer = fs.readFileSync('./test/single.csv');
    const chpType = Config.getContactType('d_community_health_volunteer_area');
    
    const places: Place[] = await PlaceFactory.createFromCsv(singleCsvBuffer, chpType, sessionCache, chtApi);
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
          uniqueKeys: {
            name: 'bob',
          }
        },
        {
          id: 'parent-id',
          name: 'chepalungu chu',
          type: 'remote',
          lineage: [],
          uniqueKeys: {
            name: 'Chepalungu CHU',
          },
        },
      ],
      validationErrors: {},
    });
  });

  it('ambiguous parent resolves if only one has the replacement', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: chtPlace._id },
    };
    fakeFormData.hierarchy_replacement = toReplace.name;

    const ambiguous = {
      ...chtPlace,
      _id: 'id-parent-ambiguous',
    };

    chtApi.getPlacesWithType
      .resolves([chtPlace, ambiguous])
      .onSecondCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('ambiguous greatgrandparent disambiguated by parent', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();

    const greatParent: ChtDoc = {
      _id: 'id-great-grandparent',
      name: 'great-grand-parent',
    };
    contactType.hierarchy[1] = {
      ...mockProperty('name', undefined, 'GREATGRANDPARENT'),
      level: 3,
      contact_type: 'greatgrandparent',
      required: false,
    };
    fakeFormData.hierarchy_GREATGRANDPARENT = greatParent.name;
    chtPlace.parent = { /*_id: ?,*/ parent: { _id: greatParent._id } };

    const ambiguous: ChtDoc = {
      ...greatParent,
      _id: 'ambiguous-great-grandparent',
    };

    chtApi.getPlacesWithType
      .resolves([greatParent, ambiguous])
      .onSecondCall().resolves([chtPlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[3]?.id).to.eq(greatParent.id);
    expect(place.resolvedHierarchy[1]?.id).to.eq(chtPlace.id);
  });

  it('ambiguous parent disambiguated by grandparent', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: ChtDoc = {
      _id: 'id-grandparent',
      name: 'grand-parent',
    };
    fakeFormData.hierarchy_GRANDPARENT = grandParent.name;
    
    const ambiguous: ChtDoc = {
      ...chtPlace,
      _id: 'id-ambiguous',
    };
    chtPlace.parent = { _id: grandParent._id };
    ambiguous.parent = { _id: 'not-grandpa' };

    chtApi.getPlacesWithType
      .resolves([grandParent])
      .onSecondCall().resolves([chtPlace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    const resolvedHierarchyIds = place.resolvedHierarchy.map(h => h?.id);
    expect(resolvedHierarchyIds).to.deep.eq([undefined, chtPlace._id, grandParent._id]);
  });

  it('#91 - no result for optional level in hierarchy causes validation error', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: ChtDoc = {
      _id: 'id-grandparent',
      name: 'grand-parent',
    };
    chtPlace.parent = { _id: grandParent._id };
    fakeFormData.hierarchy_GRANDPARENT = 'no match';

    chtApi.getPlacesWithType
      .resolves([grandParent])
      .onSecondCall().resolves([chtPlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.resolvedHierarchy[2]).to.eq(RemotePlaceResolver.NoResult);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT', 'hierarchy_GRANDPARENT'], 'Cannot find');
  });

  it('hierarchy resolution can be resolved by editing to blank', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const grandParent: ChtDoc = {
      _id: 'id-grandparent',
      name: 'grand-parent',
    };
    chtPlace.parent = { _id: grandParent._id };
    fakeFormData.hierarchy_GRANDPARENT = 'no match';

    chtApi.getPlacesWithType
      .resolves([grandParent])
      .onSecondCall().resolves([chtPlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT', 'hierarchy_GRANDPARENT'], 'Cannot find');

    fakeFormData.hierarchy_GRANDPARENT = '';
    const edited = await PlaceFactory.editOne(place.id, fakeFormData, sessionCache, chtApi);
    expect(edited.validationErrors).to.be.empty;
  });

  it('ambiguous parent disambiguated by greatgrandparent', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const greatParent: ChtDoc = {
      _id: 'id-great-grandparent',
      name: 'great-grand-parent',
    };
    contactType.hierarchy[1] = {
      ...mockProperty('name', undefined, 'GREATGRANDPARENT'),
      level: 3,
      contact_type: 'greatgrandparent',
      required: false,
    };
    fakeFormData.hierarchy_GREATGRANDPARENT = greatParent.name;
    
    const ambiguous: ChtDoc = {
      ...chtPlace,
      _id: 'id-ambiguous',
    };
    chtPlace.parent = { _id: 'no-matter', parent: { _id: greatParent._id } };
    ambiguous.parent = { _id: 'not-grandpa', parent: { _id: 'not-grandpa' } };

    chtApi.getPlacesWithType
      .resolves([greatParent])
      .onSecondCall().resolves([chtPlace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    const resolvedHierarchyIds = place.resolvedHierarchy.map(h => h?.id);
    expect(resolvedHierarchyIds).to.deep.eq([undefined, chtPlace._id, undefined, greatParent._id]);
  });

  it('ambiguous place under single parent is invalid', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
    };
    const ambiguous: ChtDoc = {
      ...toReplace,
      _id: 'id-replace-ambiguous',
      parentId: chtPlace._id,
    };

    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall()
      .resolves([toReplace, ambiguous]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(chtApi.getPlacesWithType.args).to.deep.eq([['parent'], ['contacttype-name']]);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'multiple');
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('multiple');
  });

  it('replacement place not under parent is invalid', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    
    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: 'different-parent' },
    };
    fakeFormData.hierarchy_replacement = toReplace.name;
    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'Cannot find');
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]).to.eq(RemotePlaceResolver.NoResult);
  });
  
  it('place not under users facility is invalid', async () => {
    const { chtPlace, sessionCache, contactType, parentContactType, fakeFormData, chtApi } = mockScenario();
    const parent1 = mockParentPlace(parentContactType, fakeFormData.hierarchy_PARENT);
    chtApi.getPlacesWithType.resolves([chtPlace]);
    chtApi.chtSession = mockChtSession('other');
    fakeFormData.hierarchy_PARENT = parent1.name;

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_PARENT'], 'Cannot find');
  });

  it('#124 - testing replacement when place.name is generated', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'dne';

    contactType.place_properties[0] = {
      friendly_name: '124',
      property_name: 'name',
      type: 'generated',
      parameter: '{{contact.name}} Area',
    };

    const otherPlace: ChtDoc = {
      _id: 'other-place',
      name: 'other-place',
      parent: { _id: chtPlace._id },
    };
    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace',
      parent: { _id: chtPlace._id },
    };

    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall().resolves([toReplace, otherPlace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expectInvalidProperties(place.validationErrors, ['hierarchy_replacement'], 'Cannot find');
  });

  it('#124 - replacement_property is used for fuzzing during replacement', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    contactType.replacement_property = {
      friendly_name: 'Outgoing CHP',
      property_name: 'replacement',
      type: 'name',
      parameter: ['\\sArea', '\\s\\(.*\\)'],
      required: true
    };

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace Area (village)',
      parent: { _id: chtPlace._id },
    };

    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall().resolves([toReplace]);

    const place: Place = await PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    expect(place.validationErrors).to.be.empty;
    expect(place.resolvedHierarchy[1]?.id).to.eq('parent-id');
    expect(place.resolvedHierarchy[0]?.id).to.eq('id-replace');
  });

  it('#124 - replacement_property cannot have type:"generated"', async () => {
    const { chtPlace, sessionCache, contactType, fakeFormData, chtApi } = mockScenario();
    fakeFormData.hierarchy_replacement = 'to-replace';

    contactType.replacement_property = {
      friendly_name: 'Outgoing CHP',
      property_name: 'replacement',
      type: 'generated',
      parameter: '{{ contact.name }} Area',
      required: true
    };

    const toReplace: ChtDoc = {
      _id: 'id-replace',
      name: 'to-replace Area',
      parent: { _id: chtPlace._id },
    };

    chtApi.getPlacesWithType
      .resolves([chtPlace])
      .onSecondCall().resolves([toReplace]);

    const createOne = PlaceFactory.createOne(fakeFormData, contactType, sessionCache, chtApi);
    await expect(createOne).to.eventually.be.rejectedWith('cannot be of type "generated"');
  });
});

function mockScenario() {
  const contactType = mockValidContactType('string', undefined);
  const chtPlace: ChtDoc = {
    _id: 'parent-id',
    name: 'parent-name',
  };
  const sessionCache = new SessionCache();
  const chtApi = {
    chtSession: mockChtSession(),
    getPlacesWithType: sinon.stub().resolves([chtPlace]),
    createPlace: sinon.stub().resolves('created-place-id'),
    updateContactParent: sinon.stub().resolves('created-contact-id'),
    createUser: sinon.stub().resolves(),
  };
  const fakeFormData:any = {
    place_name: 'place',
    place_prop: 'foo',
    hierarchy_PARENT: chtPlace.name,
    contact_name: 'contact',
  };
  const parentContactType = mockValidContactType('string', undefined);
  parentContactType.name = contactType.hierarchy[0].contact_type;

  return { 
    chtPlace,
    sessionCache,
    fakeFormData,
    parentContactType,
    contactType,
    chtApi
  };
}

