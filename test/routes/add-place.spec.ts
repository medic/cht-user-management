import { expect } from 'chai';
import Fastify, { FastifyInstance } from 'fastify';
import sinon from 'sinon';

import addPlace from '../../src/routes/add-place';
import { Config } from '../../src/config';
import ExternalSource from '../../src/services/external-source';
import { mockChtSession, mockValidContactType } from '../mocks';

const EXTERNAL_SOURCE = {
  id: 'source-a',
  friendly_name: 'Source A',
  url: 'https://example.com',
  api_endpoint: '/api/search',
  auth: { type: 'token', token_endpoint: '/token', client_id: 'client_id', client_secret: 'client_secret' },
  resultKey: 'results',
};

const SANITIZED_SOURCE = { id: 'source-a', friendly_name: 'Source A' };

describe('routes/add-place.ts external source routes', () => {
  let fastify: FastifyInstance;
  let viewSpy: sinon.SinonSpy;
  let getAuthStub: sinon.SinonStub;
  let searchStub: sinon.SinonStub;

  beforeEach(async () => {
    fastify = Fastify();

    // capture rendered views instead of running the liquid engine
    viewSpy = sinon.spy();
    fastify.decorateReply('view', function (this: any, page: string, data: any) {
      viewSpy(page, data);
      return this.send({ page });
    });

    fastify.addHook('preHandler', async (req) => {
      (req as any).chtSession = mockChtSession();
    });

    getAuthStub = sinon.stub().resolves('Bearer tok');
    fastify.decorate('externalSourceAuthManager', { getAuth: getAuthStub } as any);

    await fastify.register(addPlace);

    sinon.stub(Config, 'getContactType').returns(mockValidContactType('string', undefined));
    sinon.stub(Config, 'getHierarchyWithReplacement').returns([]);
    sinon.stub(Config, 'contactTypes').returns([mockValidContactType('string', undefined)]);
    sinon.stub(Config, 'getLogoBase64').returns('');
    searchStub = sinon.stub(ExternalSource, 'search');
  });

  afterEach(async () => {
    sinon.restore();
    await fastify.close();
  });

  const dataOf = () => viewSpy.firstCall.args[1];

  describe('GET /add-from-external-source', () => {
    it('renders the add-from-external-source view for a known source', async () => {
      sinon.stub(Config, 'getExternalSources').returns([EXTERNAL_SOURCE] as any);

      const resp = await fastify.inject({
        method: 'GET',
        url: '/add-from-external-source?source_id=source-a&type=contacttype-name',
      });

      expect(resp.statusCode).to.equal(200);
      expect(viewSpy.firstCall.args[0]).to.equal('src/liquid/app/view.liquid');
      const data = dataOf();
      expect(data.view).to.equal('add_from_external_source');
      expect(data.op).to.equal('add_from_external_source');
      expect(data.source.id).to.equal('source-a');
    });

    it('returns 500 when the source is unknown', async () => {
      sinon.stub(Config, 'getExternalSources').returns([EXTERNAL_SOURCE] as any);

      const resp = await fastify.inject({
        method: 'GET',
        url: '/add-from-external-source?source_id=missing&type=contacttype-name',
      });

      expect(resp.statusCode).to.equal(500);
      expect(resp.json().message).to.contain('external source missing not found');
      expect(viewSpy.called).to.be.false;
    });
  });

  describe('GET /search-external-source', () => {
    beforeEach(() => {
      sinon.stub(Config, 'getSanitizedExternalSources').returns([SANITIZED_SOURCE]);
      sinon.stub(Config, 'getExternalSourceConfigById').returns({ ...EXTERNAL_SOURCE, mapping: [] } as any);
    });

    it('renders the results view when the search returns hits', async () => {
      const results = [{ id: 'r-1', propertyValues: [] }];
      searchStub.resolves(results);

      const resp = await fastify.inject({
        method: 'GET',
        url: '/search-external-source?source_id=source-a&type=contacttype-name&place_name=Clinic',
      });

      expect(resp.statusCode).to.equal(200);
      expect(viewSpy.firstCall.args[0]).to.equal('src/liquid/place/select_external_source_result.liquid');
      const data = dataOf();
      expect(data.results).to.deep.equal(results);
      expect(data.source).to.deep.equal(SANITIZED_SOURCE);
      // the search receives only the search params, not source_id/type
      expect(getAuthStub.calledOnceWith('source-a')).to.be.true;
      expect(searchStub.firstCall.args[1]).to.deep.equal({ place_name: 'Clinic' });
      expect(searchStub.firstCall.args[2]).to.equal('Bearer tok');
    });

    it('renders the search form with an error when the source is unknown', async () => {
      const resp = await fastify.inject({
        method: 'GET',
        url: '/search-external-source?source_id=missing&type=contacttype-name',
      });

      expect(resp.statusCode).to.equal(200);
      expect(viewSpy.firstCall.args[0]).to.equal('src/liquid/place/search_external_source.liquid');
      expect(dataOf().error).to.contain('Unkown external source missing');
      expect(searchStub.called).to.be.false;
    });

    it('renders the search form with "No results found" when the search is empty', async () => {
      searchStub.resolves([]);

      const resp = await fastify.inject({
        method: 'GET',
        url: '/search-external-source?source_id=source-a&type=contacttype-name&place_name=owlphilly',
      });

      expect(resp.statusCode).to.equal(200);
      expect(viewSpy.firstCall.args[0]).to.equal('src/liquid/place/search_external_source.liquid');
      const data = dataOf();
      expect(data.error).to.equal('No results found');
      expect(data.data).to.deep.equal({ place_name: 'owlphilly' });
    });

    it('renders the search form with an error message when the search throws', async () => {
      searchStub.rejects(new Error('boom'));

      const resp = await fastify.inject({
        method: 'GET',
        url: '/search-external-source?source_id=source-a&type=contacttype-name&place_name=Clinic',
      });

      expect(resp.statusCode).to.equal(200);
      expect(viewSpy.firstCall.args[0]).to.equal('src/liquid/place/search_external_source.liquid');
      expect(dataOf().error).to.contain('Something went wrong while connecting to Source A');
    });
  });
});
