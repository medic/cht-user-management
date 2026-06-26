import Chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import axios from 'axios';

import { ExternalSourceConfig } from '../../src/config';
import ExternalSourceService, { ExternalSourceError } from '../../src/services/external-source';

Chai.use(chaiAsPromised);
const { expect } = Chai;

const mockConfig = (overrides: Partial<ExternalSourceConfig> = {}): ExternalSourceConfig => ({
  id: 'source-a',
  friendly_name: 'Source A',
  url: 'https://example.com',
  api_endpoint: '/api/search',
  auth: { type: 'token', token_endpoint: '/token', client_id_key: 'client_id', client_secret_key: 'client_secret' },
  resultKey: 'results',
  other_filters: { active: 'true' },
  mapping: [
    {
      propertyName: 'name',
      friendlyName: 'Name',
      propertyType: 'place',
      externalSourceField: 'facility.label',
      isFilter: true,
    },
    {
      propertyName: 'code',
      friendlyName: 'Code',
      propertyType: 'place',
      externalSourceField: 'facility.code',
      path: 'facility.code',
      isFilter: false,
    },
  ],
  ...overrides,
});

describe('services/external-source.ts', () => {
  afterEach(() => sinon.restore());

  describe('buildUrl', () => {
    it('joins base url and endpoint', () => {
      expect(ExternalSourceService.buildUrl('https://example.com', '/api')).to.eq('https://example.com/api');
    });

    it('trims trailing slash from base url', () => {
      expect(ExternalSourceService.buildUrl('https://example.com/', '/api')).to.eq('https://example.com/api');
    });

    it('adds leading slash to endpoint when missing', () => {
      expect(ExternalSourceService.buildUrl('https://example.com', 'api')).to.eq('https://example.com/api');
    });

    it('throws when base url is empty', () => {
      expect(() => ExternalSourceService.buildUrl('', '/api')).to.throw('Endpoint and base URL are required');
    });

    it('throws when endpoint is empty', () => {
      expect(() => ExternalSourceService.buildUrl('https://example.com', '')).to.throw('Endpoint and base URL are required');
    });

    it('throws on invalid base url', () => {
      expect(() => ExternalSourceService.buildUrl('not a url', '/api')).to.throw('Invalid base URL');
    });

    it('throws on unsupported protocol', () => {
      expect(() => ExternalSourceService.buildUrl('ftp://example.com', '/api')).to.throw('Unsupported URL protocol');
    });
  });

  describe('toExternalSourceMessage', () => {
    it('returns the message of an ExternalSourceError', () => {
      const error = new ExternalSourceError('No results found');
      expect(ExternalSourceService.toExternalSourceMessage(error, 'Source A')).to.eq('No results found');
    });

    it('returns a generic message for other errors', () => {
      const message = ExternalSourceService.toExternalSourceMessage(new Error('boom'), 'Source A');
      expect(message).to.include('Something went wrong while connecting to Source A');
    });
  });

  describe('search', () => {
    it('maps api results using the configured mapping', async () => {
      const config = mockConfig();
      sinon.stub(axios, 'get').resolves({
        data: {
          results: [
            { id: 'id-1', facility: { label: 'Clinic One', code: 'C1' } },
          ],
        },
      } as any);

      const results = await ExternalSourceService.search(config, {}, 'Bearer token');
      expect(results).to.deep.eq([
        {
          id: 'id-1',
          propertyValues: [
            { propertyName: 'name', propertyType: 'place', friendlyName: 'Name', externalSourceField: 'facility.label', value: 'Clinic One' },
            { propertyName: 'code', propertyType: 'place', friendlyName: 'Code', externalSourceField: 'facility.code', value: 'C1' },
          ],
        },
      ]);
    });

    it('falls back to uuid then _id for the result id', async () => {
      const config = mockConfig();
      sinon.stub(axios, 'get').resolves({
        data: { results: [{ uuid: 'uuid-1' }, { _id: 'underscore-1' }] },
      } as any);

      const results = await ExternalSourceService.search(config, {}, 'Bearer token');
      expect(results.map(r => r.id)).to.deep.eq(['uuid-1', 'underscore-1']);
    });

    it('limits results to 50', async () => {
      const config = mockConfig();
      const data = Array.from({ length: 60 }, (_, i) => ({ id: `id-${i}` }));
      sinon.stub(axios, 'get').resolves({ data: { results: data } } as any);

      const results = await ExternalSourceService.search(config, {}, 'Bearer token');
      expect(results).to.have.length(50);
    });

    it('builds query params from other_filters and filterable mappings', async () => {
      const config = mockConfig();
      const stub = sinon.stub(axios, 'get').resolves({ data: { results: [] } } as any);

      await ExternalSourceService.search(config, { place_name: 'Clinic' }, 'Bearer token').catch(() => { });

      const params = stub.firstCall.args[1]?.params;
      expect(params).to.deep.eq({ active: 'true', label: 'Clinic' });
    });

    it('ignores search params that are not filterable mappings', async () => {
      const config = mockConfig();
      const stub = sinon.stub(axios, 'get').resolves({ data: { results: [] } } as any);

      await ExternalSourceService.search(config, { place_code: 'C1' }, 'Bearer token').catch(() => { });

      const params = stub.firstCall.args[1]?.params;
      expect(params).to.deep.eq({ active: 'true' });
    });

    it('returns empty when result key is missing', async () => {
      const config = mockConfig();
      sinon.stub(axios, 'get').resolves({ data: {} } as any);
      const results = await ExternalSourceService.search(config, {}, 'Bearer token');
      expect(results).to.deep.eq([]);
    });

    it('throws when mapping is empty', async () => {
      const config = mockConfig({ mapping: [] });
      await expect(ExternalSourceService.search(config, {}, 'Bearer token'))
        .to.be.rejectedWith('mapping configuration is required');
    });

    it('throws ExternalSourceError "No results found" on 404', async () => {
      const config = mockConfig();
      const error: any = new Error('Not Found');
      error.isAxiosError = true;
      error.response = { status: 404, data: {} };
      sinon.stub(axios, 'get').rejects(error);
      sinon.stub(axios, 'isAxiosError').returns(true);

      await expect(ExternalSourceService.search(config, {}, 'Bearer token'))
        .to.be.rejectedWith(ExternalSourceError, 'No results found');
    });

    it('throws ExternalSourceError "Could not connect" on other axios errors', async () => {
      const config = mockConfig();
      const error: any = new Error('Server Error');
      error.isAxiosError = true;
      error.response = { status: 500, data: {} };
      sinon.stub(axios, 'get').rejects(error);
      sinon.stub(axios, 'isAxiosError').returns(true);

      await expect(ExternalSourceService.search(config, {}, 'Bearer token'))
        .to.be.rejectedWith(ExternalSourceError, 'Could not connect to Source A');
    });

    it('throws when result is not an array', async () => {
      const config = mockConfig();
      sinon.stub(axios, 'get').resolves({ data: { results: 'not-an-array' } } as any);

      await expect(ExternalSourceService.search(config, {}, 'Bearer token'))
        .to.be.rejectedWith('Expected result to be an array');
    });
  });
});
