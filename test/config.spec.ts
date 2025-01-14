import { expect } from 'chai';

import { Config, PartnerConfig } from '../src/config';
import { DEFAULT_CONFIG_MAP } from '../src/config/config-factory';
import { mockSimpleContactType } from './mocks';

const mockPartnerConfig = (): PartnerConfig => ({
  config: {
    domains: [],
    contact_types: [mockSimpleContactType('string')],
    logoBase64: '',
  }
});

describe('config', () => {
  it('mock partner config is valid', () => {
    const mockConfig = mockPartnerConfig();
    Config.assertValid(mockConfig);
  });

  it('assert on unknown property type', async () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].type = 'unknown';
    await expect(Config.assertValid(mockConfig)).to.be.rejectedWith('type "unknown"');
  });
  
  it('place name is always required', async () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].place_properties.shift();
    await expect(Config.assertValid(mockConfig)).to.be.rejectedWith('"name"');
  });

  it('contact name is always required', async () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].contact_properties.shift();
    await expect(Config.assertValid(mockConfig)).to.be.rejectedWith('"name"');
  });

  it('contact_properties can have unique attributes', () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].contact_properties[0].unique = 'parent';
    Config.assertValid(mockConfig);
  });

  it('hierarchy properties cannot have unique attributes', async () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].unique = 'parent';
    await expect(Config.assertValid(mockConfig)).to.be.rejectedWith('with "unique" values');
  });

  it('parent hierarchy level is required', async () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].level = 2;
    await expect(Config.assertValid(mockConfig)).to.be.rejectedWith('with parent level');
  });
  
  it('#124 - cannot have generated property in hierarchy', async () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].hierarchy[0].type = 'generated';
    await expect(Config.assertValid(mockConfig)).to.be.rejectedWith('cannot be of type "generated"');
  });

  it('#124 - cannot have generated property as replacement_property', async () => {
    const mockConfig = mockPartnerConfig();
    mockConfig.config.contact_types[0].replacement_property.type = 'generated';
    await expect(Config.assertValid(mockConfig)).to.be.rejectedWith('cannot be of type "generated"');
  });

  const configs = Object.entries(DEFAULT_CONFIG_MAP);
  for (const [configName, partnerConfig] of configs) {
    it(`config ${configName} is valid`, async () => {
      await Config.assertValid(partnerConfig);
    });
  }
});
