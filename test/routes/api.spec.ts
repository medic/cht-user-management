import { expect } from 'chai';
import Fastify, { FastifyInstance } from 'fastify';
import sinon from 'sinon';

import api from '../../src/routes/api';
import { Config } from '../../src/config';
import RemotePlaceCache, { RemotePlace } from '../../src/lib/remote-place-cache';
import RemotePlaceResolver from '../../src/lib/remote-place-resolver';
import PlaceFactory from '../../src/services/place-factory';
import Place, { PlaceUploadState } from '../../src/services/place';
import WarningSystem from '../../src/warnings';
import ManageHierarchyLib from '../../src/lib/manage-hierarchy';
import { DisableUsers } from '../../src/lib/disable-users';
import { SetUserFacilities } from '../../src/services/set-user-facilities';
import { ChtApi } from '../../src/lib/cht-api';
import { UnvalidatedPropertyValue } from '../../src/property-value';
import { mockChtSession, mockValidContactType } from '../mocks';

const PARENT_ID = 'parent-1';

function fakeChild(id: string, name: string, parentId: string = PARENT_ID): RemotePlace {
  return {
    id,
    name: new UnvalidatedPropertyValue(name),
    placeType: 'contacttype-name',
    lineage: [parentId],
    uniquePlaceValues: {},
    type: 'remote',
  };
}

function fakeParent(id: string): RemotePlace {
  return {
    id,
    name: new UnvalidatedPropertyValue('parent'),
    placeType: 'parent',
    lineage: [],
    uniquePlaceValues: {},
    type: 'remote',
  };
}

function fakeJob(overrides: Record<string, any> = {}) {
  return {
    jobName: 'move_[a]_to_[b]',
    jobData: {
      action: 'move' as const,
      instanceUrl: 'http://cht.example.com',
      sessionToken: 'tok',
      sourceId: 'src-1',
      destinationId: 'dst-1',
      ...overrides,
    },
  };
}

describe('routes/api.ts', () => {
  let fastify: FastifyInstance;
  let placeFactoryStub: sinon.SinonStub;
  let getRemotePlacesStub: sinon.SinonStub;
  let setWarningsStub: sinon.SinonStub;
  let uploadStub: sinon.SinonStub;
  let getJobDetailsStub: sinon.SinonStub;
  let scheduleJobStub: sinon.SinonStub;
  let disableUsersStub: sinon.SinonStub;
  let setUserFacilitiesStub: sinon.SinonStub;
  let unassignFacilitiesStub: sinon.SinonStub;
  let createUserStub: sinon.SinonStub;
  let createPersonStub: sinon.SinonStub;
  let updatePlaceStub: sinon.SinonStub;

  /**
   * Configure PlaceFactory.createOne to return a Place stub whose
   * resolvedHierarchy[1] is the chosen parent — used by /search assertions
   * that only need the resolved-parent shape.
   */
  function stubResolvedParent(parent: RemotePlace) {
    placeFactoryStub.callsFake(async () => ({
      resolvedHierarchy: [undefined, parent],
    } as unknown as Place));
  }

  /**
   * Configure PlaceFactory.createOne to return a more complete Place stub
   * suitable for /create (validate, hasValidationErrors, id, contact.id,
   * warnings). Returns the stub object so tests can introspect it.
   */
  function stubCreatedPlace(opts: {
    parent?: RemotePlace;
    validationErrors?: Record<string, string>;
    id?: string;
    contactId?: string;
    username?: string;
    password?: string;
    warnings?: string[];
    state?: PlaceUploadState;
    uploadError?: string;
  } = {}) {
    const place = {
      id: opts.id ?? 'place-1',
      contact: { id: opts.contactId ?? 'contact-1' },
      resolvedHierarchy: opts.parent ? [undefined, opts.parent] : [],
      validate: sinon.stub(),
      hasValidationErrors: !!opts.validationErrors,
      validationErrors: opts.validationErrors ?? {},
      warnings: opts.warnings ?? [],
      state: opts.state ?? PlaceUploadState.SUCCESS,
      uploadError: opts.uploadError,
      creationDetails: {
        placeId: opts.id ?? 'place-1',
        contactId: opts.contactId ?? 'contact-1',
        username: opts.username ?? 'user-1',
        password: opts.password ?? 'pw-1',
      },
    };
    placeFactoryStub.callsFake(async () => place as unknown as Place);
    return place;
  }

  beforeEach(async () => {
    fastify = Fastify();
    fastify.addHook('preHandler', async (req) => {
      (req as any).chtSession = mockChtSession();
      (req as any).sessionCache = { removeAll: sinon.stub() };
    });

    uploadStub = sinon.stub().resolves();
    fastify.decorate('uploadManager', { doUpload: uploadStub } as any);

    await fastify.register(api);

    sinon.stub(Config, 'getContactType').returns(mockValidContactType('string', undefined));
    placeFactoryStub = sinon.stub(PlaceFactory, 'createOne').callsFake(async () => ({
      resolvedHierarchy: [],
    } as unknown as Place));
    getRemotePlacesStub = sinon.stub(RemotePlaceCache, 'getRemotePlaces').resolves([]);
    setWarningsStub = sinon.stub(WarningSystem, 'setWarnings').resolves();
    getJobDetailsStub = sinon.stub(ManageHierarchyLib, 'getJobDetails').resolves(fakeJob());
    scheduleJobStub = sinon.stub(ManageHierarchyLib, 'scheduleJob').resolves();
    disableUsersStub = sinon.stub(DisableUsers, 'disableUsersAt').resolves([]);
    setUserFacilitiesStub = sinon.stub(SetUserFacilities, 'setFacilities').resolves({
      username: 'target', facilityIds: ['fac-a'], unassigned: [],
    });
    unassignFacilitiesStub = sinon.stub(SetUserFacilities, 'unassignFacilitiesFromOthers').resolves([]);
    createUserStub = sinon.stub(ChtApi.prototype, 'createUser').resolves();
    sinon.stub(ChtApi.prototype, 'getDoc').resolves({ _id: 'fac-a', contact: { _id: 'primary-contact-1' } });
    createPersonStub = sinon.stub(ChtApi.prototype, 'createPersonUnderPlace').resolves('new-contact-1');
    updatePlaceStub = sinon.stub(ChtApi.prototype, 'updatePlace').resolves({} as any);
  });

  afterEach(async () => {
    sinon.restore();
    await fastify.close();
  });

  describe('POST /api/v1/search', () => {
    it('returns places of the requested type under the resolved parent, ranked best-match first', async () => {
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([
        fakeChild('p-jane', 'Jane Doe'),
        fakeChild('p-janet', 'Janet Doe'),
        fakeChild('p-other', 'Jane Doe', 'other-parent'),
      ]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        payload: { PARENT: 'parent', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      const hits = resp.json();
      expect(hits.map((h: any) => h.place_id)).to.deep.equal(['p-jane', 'p-janet']);
      expect(hits[0].name).to.equal('Jane Doe');
      expect(hits[0].score).to.be.lessThan(hits[1].score); // lower fuse score = better match
    });

    it('reports a missing parent in the body when no resolved place is found', async () => {
      stubResolvedParent(RemotePlaceResolver.NoResult);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        payload: { PARENT: 'wrong', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        error: 'hierarchy cannot be resolved: index 1 - Place Not Found',
        parentMissing: true,
        isAmbiguous: false,
      });
    });

    it('reports an ambiguous parent in the body when multiple places match', async () => {
      stubResolvedParent(RemotePlaceResolver.Multiple);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        payload: { PARENT: 'ambiguous', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        error: 'hierarchy cannot be resolved: index 1 - multiple places',
        parentMissing: false,
        isAmbiguous: true,
      });
    });

    it('returns empty when no places of the requested type share the resolved parent', async () => {
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([fakeChild('p-elsewhere', 'Jane Doe', 'other-parent')]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        payload: { PARENT: 'parent', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal([]);
    });

    it('only forwards parent hierarchy fields to PlaceFactory (drops leaf and unrelated keys)', async () => {
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([fakeChild('p-jane', 'Jane Doe')]);

      await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        payload: { PARENT: 'p', GRANDPARENT: 'gp', replacement: 'Jane Doe', UNRELATED: 'noise' },
      });

      expect(placeFactoryStub.calledOnce).to.be.true;
      const dataPassed = placeFactoryStub.firstCall.args[0];
      expect(dataPassed).to.deep.equal({ PARENT: 'p', GRANDPARENT: 'gp' });
      expect(dataPassed).to.not.have.property('replacement');
      expect(dataPassed).to.not.have.property('UNRELATED');
    });

    it('honours the query threshold by tightening Fuse cutoff', async () => {
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([
        fakeChild('p-jane', 'Jane Doe'),
        fakeChild('p-totally', 'Totally Different XYZ'),
      ]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything&threshold=0.1',
        payload: { PARENT: 'parent', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      const hits = resp.json();
      expect(hits.map((h: any) => h.place_id)).to.deep.equal(['p-jane']);
    });

    it('clears the cache before searching when clear_cache=1', async () => {
      const clearStub = sinon.stub(RemotePlaceCache, 'clear');
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([fakeChild('p-jane', 'Jane Doe')]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything&clear_cache=1',
        payload: { PARENT: 'parent', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(clearStub.calledOnce).to.be.true;
    });

    it('does not clear the cache when clear_cache is absent', async () => {
      const clearStub = sinon.stub(RemotePlaceCache, 'clear');
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([fakeChild('p-jane', 'Jane Doe')]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        payload: { PARENT: 'parent', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(clearStub.called).to.be.false;
    });

    it('returns 500 when type is unknown', async () => {
      (Config.getContactType as sinon.SinonStub).restore();
      sinon.stub(Config, 'getContactType').throws(new Error('unrecognized contact type: "bogus"'));

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=bogus',
        payload: { replacement: 'Jane' },
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('unrecognized contact type');
    });

    it('rejects a non-object body (array)', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        headers: { 'Content-Type': 'application/json' },
        payload: '["not","an","object"]',
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(placeFactoryStub.called).to.be.false;
    });

    it('rejects a null body', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/search?type=anything',
        headers: { 'Content-Type': 'application/json' },
        payload: 'null',
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
    });
  });

  describe('POST /api/v1/disable-users-at', () => {
    it('disables users at the best-match facility resolved from the hierarchy', async () => {
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([
        fakeChild('chp-jane', 'Jane Doe'),
        fakeChild('chp-janet', 'Janet Doe'),
      ]);
      disableUsersStub.resolves(['user-a', 'user-b']);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/disable-users-at?type=anything',
        payload: { COUNTY: 'county', SUBCOUNTY: 'subcounty', CHU: 'chu', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        place_id: 'chp-jane',
        place_name: 'Jane Doe',
        disabled: ['user-a', 'user-b'],
      });
      expect(disableUsersStub.calledOnceWithExactly(['chp-jane'], sinon.match.any)).to.be.true;
    });

    it('aborts and skips disabling when multiple facilities tie for the best match', async () => {
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([
        fakeChild('chp-jane', 'Jane Doe'),
        fakeChild('chp-jane-dup', 'Jane Doe'),
      ]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/disable-users-at?type=anything',
        payload: { COUNTY: 'county', SUBCOUNTY: 'subcounty', CHU: 'chu', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      const body = resp.json();
      expect(body.success).to.be.false;
      expect(body.isDuplicate).to.be.true;
      expect(body.error).to.contain('tie for the best match');
      expect(disableUsersStub.called).to.be.false;
    });

    it('returns a not-found envelope and skips disabling when no facility matches', async () => {
      stubResolvedParent(fakeParent(PARENT_ID));
      getRemotePlacesStub.resolves([fakeChild('chp-elsewhere', 'Jane Doe', 'other-parent')]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/disable-users-at?type=anything',
        payload: { COUNTY: 'county', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        success: false,
        error: 'no facility found matching the provided hierarchy',
      });
      expect(disableUsersStub.called).to.be.false;
    });

    it('propagates the hierarchy error envelope and skips disabling', async () => {
      stubResolvedParent(RemotePlaceResolver.NoResult);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/disable-users-at?type=anything',
        payload: { COUNTY: 'wrong', replacement: 'Jane Doe' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        error: 'hierarchy cannot be resolved: index 1 - Place Not Found',
        parentMissing: true,
        isAmbiguous: false,
      });
      expect(disableUsersStub.called).to.be.false;
    });

    it('rejects a non-object body (array)', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/disable-users-at?type=anything',
        payload: ['not', 'an', 'object'],
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(disableUsersStub.called).to.be.false;
    });
  });

  describe('POST /api/v1/set-user-facilities', () => {
    it('sets the facilities for the user and returns the service result', async () => {
      setUserFacilitiesStub.resolves({
        username: 'jdoe',
        facilityIds: ['fac-a', 'fac-b'],
        unassigned: [{ username: 'other', remaining: ['fac-z'] }],
      });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/set-user-facilities',
        payload: { username: 'jdoe', facility_ids: ['fac-a', 'fac-b'] },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        username: 'jdoe',
        facilityIds: ['fac-a', 'fac-b'],
        unassigned: [{ username: 'other', remaining: ['fac-z'] }],
      });
      const [username, facilityIds] = setUserFacilitiesStub.firstCall.args;
      expect(username).to.equal('jdoe');
      expect(facilityIds).to.deep.equal(['fac-a', 'fac-b']);
    });

    it('derives the username from oidc_username when provided', async () => {
      setUserFacilitiesStub.resolves({
        username: 'demoemailcom',
        facilityIds: ['fac-a'],
        unassigned: [],
      });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/set-user-facilities',
        payload: { oidc_username: 'demo@email.com', facility_ids: ['fac-a'] },
      });

      expect(resp.statusCode).to.equal(200);
      const [username, facilityIds] = setUserFacilitiesStub.firstCall.args;
      expect(username).to.equal('demoemailcom');
      expect(facilityIds).to.deep.equal(['fac-a']);
    });

    it('rejects a missing username without calling the service', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/set-user-facilities',
        payload: { facility_ids: ['fac-a'] },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ success: false, errors: 'username is required' });
      expect(setUserFacilitiesStub.called).to.be.false;
    });

    it('rejects an empty facility_ids array without calling the service', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/set-user-facilities',
        payload: { username: 'jdoe', facility_ids: [] },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        success: false,
        errors: 'facility_ids must be a non-empty array of place ids',
      });
      expect(setUserFacilitiesStub.called).to.be.false;
    });

    it('returns the error envelope when the service throws', async () => {
      setUserFacilitiesStub.rejects(new Error('Not Found'));

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/set-user-facilities',
        payload: { username: 'ghost', facility_ids: ['fac-a'] },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ error: 'Error: Not Found' });
    });

    it('rejects a non-object body (array)', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/set-user-facilities',
        payload: ['not', 'an', 'object'],
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(setUserFacilitiesStub.called).to.be.false;
    });
  });

  describe('POST /api/v1/create-user-and-place', () => {
    it('uploads the place and returns place_id, contact_id and warnings', async () => {
      stubCreatedPlace({
        parent: fakeParent(PARENT_ID),
        id: 'p-1',
        contactId: 'c-1',
        warnings: ['heads up'],
      });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=anything',
        payload: { PARENT: 'parent', name: 'Jane Doe', phone: '0712345678' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        place_id: 'p-1',
        contact_id: 'c-1',
        username: 'user-1',
        password: 'pw-1',
        warnings: ['heads up'],
      });
      expect(setWarningsStub.calledOnce).to.be.true;
      expect(uploadStub.calledOnce).to.be.true;
      const [places, chtApi] = uploadStub.firstCall.args;
      expect(places).to.have.length(1);
      expect(places[0].id).to.equal('p-1');
      expect(chtApi).to.exist;
    });

    it('returns the hierarchy error envelope when the parent is missing', async () => {
      stubCreatedPlace({ parent: RemotePlaceResolver.NoResult });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=anything',
        payload: { PARENT: 'wrong', name: 'Jane' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        error: 'hierarchy cannot be resolved: index 1 - Place Not Found',
        parentMissing: true,
        isAmbiguous: false,
      });
      expect(uploadStub.called).to.be.false;
      expect(setWarningsStub.called).to.be.false;
    });

    it('returns the hierarchy error envelope when the parent is ambiguous', async () => {
      stubCreatedPlace({ parent: RemotePlaceResolver.Multiple });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=anything',
        payload: { PARENT: 'ambiguous', name: 'Jane' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        error: 'hierarchy cannot be resolved: index 1 - multiple places',
        parentMissing: false,
        isAmbiguous: true,
      });
      expect(uploadStub.called).to.be.false;
    });

    it('returns validation errors and skips upload when the place is invalid', async () => {
      const errors = { contact_name: 'name is required', contact_phone: 'phone is required' };
      stubCreatedPlace({ parent: fakeParent(PARENT_ID), validationErrors: errors });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=anything',
        payload: { PARENT: 'parent' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ success: false, errors });
      expect(uploadStub.called).to.be.false;
      expect(setWarningsStub.called).to.be.false;
    });

    it('returns the upload-failure envelope when state is not SUCCESS after upload', async () => {
      stubCreatedPlace({
        parent: fakeParent(PARENT_ID),
        state: PlaceUploadState.FAILURE,
        uploadError: 'CHT api rejected: 500',
      });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=anything',
        payload: { PARENT: 'parent', name: 'Jane', phone: '0712345678' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        success: false,
        errors: 'CHT api rejected: 500',
      });
      expect(setWarningsStub.calledOnce).to.be.true;
      expect(uploadStub.calledOnce).to.be.true;
    });

    it('returns 500 when type is unknown', async () => {
      (Config.getContactType as sinon.SinonStub).restore();
      sinon.stub(Config, 'getContactType').throws(new Error('unrecognized contact type: "bogus"'));

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=bogus',
        payload: { name: 'Jane' },
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('unrecognized contact type');
      expect(uploadStub.called).to.be.false;
    });

    it('rejects a non-object body (array)', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=anything',
        payload: [{ name: 'Jane' }],
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(placeFactoryStub.called).to.be.false;
      expect(uploadStub.called).to.be.false;
    });

    it('rejects a null body', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user-and-place?type=anything',
        headers: { 'Content-Type': 'application/json' },
        payload: 'null',
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(uploadStub.called).to.be.false;
    });
  });

  describe('POST /api/v1/create-user', () => {
    const validContact = { type: 'person', name: 'Jane CHA', phone: '+254700000000' };

    it('creates a fresh contact, makes it primary on every facility, and creates the user', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: {
          oidc_username: 'demo@email.com', role: 'chw', facility_ids: ['fac-a', 'fac-b'], contact: validContact,
        },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ success: true, username: 'demo_at_email_dot_com' });

      // A new person is created inside the first facility from the supplied details (verbatim).
      expect(createPersonStub.calledOnceWith('fac-a', validContact)).to.be.true;
      // Every facility is updated to use the new contact as its primary contact.
      expect(updatePlaceStub.callCount).to.equal(2);
      expect(updatePlaceStub.getCall(0).args).to.deep.equal(['fac-a', 'new-contact-1']);
      expect(updatePlaceStub.getCall(1).args).to.deep.equal(['fac-b', 'new-contact-1']);
      // The user is attached to the new contact across all facilities.
      expect({ ...createUserStub.firstCall.args[0] }).to.deep.equal({
        username: 'demo_at_email_dot_com',
        oidc_username: 'demo@email.com',
        roles: ['chw'],
        place: ['fac-a', 'fac-b'],
        contact: 'new-contact-1',
      });
      // Without the opt-in flag, other users keep their facilities.
      expect(unassignFacilitiesStub.called).to.be.false;
    });

    it('strips the facilities from other users when exclusiveFacilities=true', async () => {
      unassignFacilitiesStub.resolves([{ username: 'other', remaining: [] }]);

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user?exclusiveFacilities=true',
        payload: {
          oidc_username: 'demo@email.com', role: 'chw', facility_ids: ['fac-a', 'fac-b'], contact: validContact,
        },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        success: true,
        username: 'demo_at_email_dot_com',
        unassigned: [{ username: 'other', remaining: [] }],
      });
      expect(unassignFacilitiesStub.calledOnceWithExactly(['fac-a', 'fac-b'], 'demo_at_email_dot_com', sinon.match.any)).to.be.true;
    });

    it('accepts a roles array', async () => {
      await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { oidc_username: 'demo@email.com', roles: ['chw', 'supervisor'], facility_ids: ['fac-a'], contact: validContact },
      });

      expect(createUserStub.firstCall.args[0].roles).to.deep.equal(['chw', 'supervisor']);
    });

    it('rejects a missing oidc_username without creating anything', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { role: 'chw', facility_ids: ['fac-a'], contact: validContact },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ success: false, errors: 'oidc_username is required' });
      expect(createPersonStub.called).to.be.false;
      expect(createUserStub.called).to.be.false;
    });

    it('rejects a missing role without creating anything', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { oidc_username: 'demo@email.com', facility_ids: ['fac-a'], contact: validContact },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ success: false, errors: 'role is required' });
      expect(createPersonStub.called).to.be.false;
      expect(createUserStub.called).to.be.false;
    });

    it('rejects empty facility_ids without creating anything', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { oidc_username: 'demo@email.com', role: 'chw', facility_ids: [], contact: validContact },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        success: false,
        errors: 'facility_ids must be a non-empty array of place ids',
      });
      expect(createPersonStub.called).to.be.false;
      expect(createUserStub.called).to.be.false;
    });

    it('rejects a missing contact without creating anything', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { oidc_username: 'demo@email.com', role: 'chw', facility_ids: ['fac-a'] },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ success: false, errors: 'contact is required and must include a name' });
      expect(createPersonStub.called).to.be.false;
      expect(createUserStub.called).to.be.false;
    });

    it('rejects a contact without a name', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { oidc_username: 'demo@email.com', role: 'chw', facility_ids: ['fac-a'], contact: { phone: '123' } },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ success: false, errors: 'contact is required and must include a name' });
      expect(createPersonStub.called).to.be.false;
    });

    it('returns the error envelope when contact creation fails', async () => {
      createPersonStub.rejects({ response: { data: { error: { message: 'no such place' } } } });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { oidc_username: 'demo@email.com', role: 'chw', facility_ids: ['fac-a'], contact: validContact },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ error: 'no such place' });
      expect(createUserStub.called).to.be.false;
    });

    it('returns the error envelope when createUser fails', async () => {
      createUserStub.rejects({ response: { data: { error: { message: 'oidc_username already exists' } } } });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: { oidc_username: 'dupe@email.com', role: 'chw', facility_ids: ['fac-a'], contact: validContact },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({ error: 'oidc_username already exists' });
    });

    it('rejects a non-object body (array)', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/create-user',
        payload: ['not', 'an', 'object'],
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(createUserStub.called).to.be.false;
    });
  });

  describe('POST /api/v1/manage-hierarchy', () => {
    it('schedules the job and returns its summary fields', async () => {
      getJobDetailsStub.resolves({
        jobName: 'merge_[src]_to_[dst]',
        jobData: {
          action: 'merge',
          instanceUrl: 'http://cht.example.com',
          sessionToken: 'tok',
          sourceId: 'chu-source',
          destinationId: 'chu-dest',
        },
      });

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/manage-hierarchy',
        payload: {
          place_type: 'anything',
          op: 'merge',
          source_replacement: 'A',
          destination_replacement: 'B',
        },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        jobName: 'merge_[src]_to_[dst]',
        action: 'merge',
        instanceUrl: 'http://cht.example.com',
        sourceId: 'chu-source',
        destinationId: 'chu-dest',
      });
      expect(getJobDetailsStub.calledOnce).to.be.true;
      expect(scheduleJobStub.calledOnce).to.be.true;
    });

    it('returns the error envelope when getJobDetails throws', async () => {
      getJobDetailsStub.rejects(new Error('source place could not be resolved'));

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/manage-hierarchy',
        payload: { place_type: 'anything', op: 'move' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        error: 'Error: source place could not be resolved',
      });
      expect(scheduleJobStub.called).to.be.false;
    });

    it('returns the error envelope when scheduleJob throws', async () => {
      scheduleJobStub.rejects(new Error('queue unavailable'));

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/manage-hierarchy',
        payload: { place_type: 'anything', op: 'move' },
      });

      expect(resp.statusCode).to.equal(200);
      expect(resp.json()).to.deep.equal({
        error: 'Error: queue unavailable',
      });
      expect(getJobDetailsStub.calledOnce).to.be.true;
    });

    it('returns 500 when place_type is unknown (Config.getContactType throws outside the try)', async () => {
      (Config.getContactType as sinon.SinonStub).restore();
      sinon.stub(Config, 'getContactType').throws(new Error('unrecognized contact type: "bogus"'));

      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/manage-hierarchy',
        payload: { place_type: 'bogus', op: 'move' },
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('unrecognized contact type');
      expect(getJobDetailsStub.called).to.be.false;
      expect(scheduleJobStub.called).to.be.false;
    });

    it('rejects a non-object body (array)', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/manage-hierarchy',
        payload: ['not', 'an', 'object'],
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(getJobDetailsStub.called).to.be.false;
      expect(scheduleJobStub.called).to.be.false;
    });

    it('rejects a null body', async () => {
      const resp = await fastify.inject({
        method: 'POST',
        url: '/api/v1/manage-hierarchy',
        headers: { 'Content-Type': 'application/json' },
        payload: 'null',
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('body expected as application/json');
      expect(getJobDetailsStub.called).to.be.false;
    });
  });
});
