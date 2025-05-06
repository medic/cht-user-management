import { expect } from 'chai';
import sinon from 'sinon';
import { UploadSuperset } from '../../src/services/upload-superset';
import { SupersetApi } from '../../src/lib/superset-api';
import Place from '../../src/services/place';
import { mockSupersetContactType, mockValidContactType } from '../mocks';
import { UnvalidatedPropertyValue } from '../../src/property-value';
import chaiAsPromised from 'chai-as-promised';
import Chai from 'chai';

Chai.use(chaiAsPromised);

describe('services/upload-superset.ts', () => {
  let supersetApi: SupersetApi;
  let uploadSuperset: UploadSuperset;
  let mockPlace: Place;

  beforeEach(() => {
    supersetApi = {
      createRole: sinon.stub().resolves(123) as unknown as SupersetApi['createRole'],
      getPermissionsByRoleID: sinon.stub().resolves([1, 2]) as unknown as SupersetApi['getPermissionsByRoleID'],
      assignPermissionsToRole: sinon.stub().resolves() as unknown as SupersetApi['assignPermissionsToRole'],
      getTablesByRlsID: sinon.stub().resolves([{ id: 456 }]) as unknown as SupersetApi['getTablesByRlsID'],
      createRowLevelSecurityFromTemplate: sinon.stub().resolves() as unknown as SupersetApi['createRowLevelSecurityFromTemplate'],
      createUser: sinon.stub().resolves() as unknown as SupersetApi['createUser']
    } as SupersetApi;

    uploadSuperset = new UploadSuperset(supersetApi);
    const contactType = mockSupersetContactType();
    mockPlace = new Place(contactType);
    mockPlace.properties.name = new UnvalidatedPropertyValue('Test Place');
    mockPlace.contact.properties.name = new UnvalidatedPropertyValue('test contact');
    mockPlace.contact.properties.email = new UnvalidatedPropertyValue('test@example.com');
    mockPlace.supersetProperties.superset_mode = new UnvalidatedPropertyValue('enable');
    mockPlace.creationDetails.username = 'test_contact';
    mockPlace.creationDetails.password = 'password';
  });

  it('should create role and assign permissions', async () => {
    await uploadSuperset.handlePlace(mockPlace);

    sinon.assert.calledWith(supersetApi.createRole as sinon.SinonStub, 'CHU', 'Test Place');
    sinon.assert.calledWith(supersetApi.getPermissionsByRoleID as sinon.SinonStub, 16); // role_template is "16" from the mockSupersetContactType
    sinon.assert.calledWith(
      supersetApi.assignPermissionsToRole as sinon.SinonStub,
      123,
      [1, 2]
    );
  });

  it('should set up row-level security', async () => {
    await uploadSuperset.handlePlace(mockPlace);

    sinon.assert.calledWith(supersetApi.getTablesByRlsID as sinon.SinonStub, 6); // rls_template is "6" from the mockSupersetContactType
    sinon.assert.calledWith(
      supersetApi.createRowLevelSecurityFromTemplate as sinon.SinonStub,
      123,
      'Test Place',
      'chu_name',
      'CHU',
      [456]
    );
  });

  it('should create user with role', async () => {
    await uploadSuperset.handlePlace(mockPlace);

    sinon.assert.called(supersetApi.createUser as sinon.SinonStub);
    const userPayload = (supersetApi.createUser as sinon.SinonStub).args[0][0];
    expect(userPayload).to.deep.include({
      username: 'test_contact',
      password: 'password',
      email: 'test@example.com',
      roles: [123]
    });
  });

  it('should throw error if Superset is not configured', async () => {
    const placeWithoutSuperset = new Place(mockValidContactType('string', undefined));
    await expect(uploadSuperset.handlePlace(placeWithoutSuperset))
      .to.eventually.be.rejectedWith('Superset integration is not enabled');
  });

  it('should throw error if email is missing', async () => {
    delete mockPlace.contact.properties.email;
    await expect(uploadSuperset.handlePlace(mockPlace))
      .to.eventually.be.rejectedWith('Email is required for Superset integration');
  });

  describe('handleGroup', () => {
    let mockPlaces: Place[];

    beforeEach(() => {
      mockPlaces = [
        mockPlace,
        new Place(mockSupersetContactType()),
        new Place(mockSupersetContactType())
      ];

      // Set up the first place with Superset user ID and roles
      mockPlaces[0].creationDetails.username = 'test_contact';
      mockPlaces[0].creationDetails.password = 'password';
      mockPlaces[0].creationDetails.email = 'test@example.com';
      mockPlaces[0].creationDetails.name = 'Test Contact';
      mockPlaces[0].creationDetails.supersetUserId = 1;
      mockPlaces[0].creationDetails.supersetRoles = [1];

      // Set up the other places with the same credentials
      mockPlaces[1].properties.name = new UnvalidatedPropertyValue('Test Place 2');
      mockPlaces[1].contact.properties.email = new UnvalidatedPropertyValue('test@example.com');
      mockPlaces[1].creationDetails.username = 'test_contact';
      mockPlaces[1].creationDetails.password = 'password';
      mockPlaces[1].creationDetails.email = 'test@example.com';
      mockPlaces[1].creationDetails.name = 'Test Contact';

      mockPlaces[2].properties.name = new UnvalidatedPropertyValue('Test Place 3');
      mockPlaces[2].contact.properties.email = new UnvalidatedPropertyValue('test@example.com');
      mockPlaces[2].creationDetails.username = 'test_contact';
      mockPlaces[2].creationDetails.password = 'password';
      mockPlaces[2].creationDetails.email = 'test@example.com';
      mockPlaces[2].creationDetails.name = 'Test Contact';
    });

    it('should create roles and RLS for remaining places and update existing user', async () => {
      // Mock createRole to return different IDs for each call
      (supersetApi.createRole as sinon.SinonStub)
        .onFirstCall().resolves({ id: 2 })
        .onSecondCall().resolves({ id: 3 });

      await uploadSuperset.handleGroup(mockPlaces);

      // Verify createRole was called twice (for place2 and place3)
      sinon.assert.calledTwice(supersetApi.createRole as sinon.SinonStub);

      // Verify updateUser was called with all role IDs
      sinon.assert.calledOnceWithExactly(supersetApi.updateUser as sinon.SinonStub, 1, {
        roles: [1, 2, 3]
      });
    });

    it('should throw error if no places provided', async () => {
      await expect(uploadSuperset.handleGroup([])).to.be.rejectedWith('No places provided for group creation');
    });

    it('should throw error if first place has no Superset user ID', async () => {
      const testPlace = new Place(mockSupersetContactType());
      testPlace.properties.name = new UnvalidatedPropertyValue('Test Place');
      testPlace.contact.properties.email = new UnvalidatedPropertyValue('test@example.com');
      testPlace.creationDetails.username = 'test_contact';
      testPlace.creationDetails.password = 'password';
      testPlace.creationDetails.email = 'test@example.com';
      testPlace.creationDetails.name = 'Test Contact';

      await expect(uploadSuperset.handleGroup([testPlace])).to.be.rejectedWith('First place must have a Superset user ID');
    });

    it('should handle API failures gracefully', async () => {
      (supersetApi.createRole as sinon.SinonStub).rejects(new Error('API Error'));
      await expect(uploadSuperset.handleGroup(mockPlaces)).to.be.rejectedWith('Failed to set up Superset for group of places: API Error');
    });
  });
});
