import { ConfigSystem, PartnerConfig } from '.';
import kenyaConfig from './chis-ke';
import togoConfig from './chis-tg';
import civConfig from './chis-civ';
import maliConfig from './chis-ml';
import defaultConfig from './default-config';
import path from 'path';
import fs from 'fs';

export default class ConfigFactory {
  private config: PartnerConfig | null = null;
  private static configFactoryInstance: ConfigFactory;
  private filePath: string;

  private DEFAULT_CONFIG_MAP: { [key: string]: PartnerConfig } = {
    'CHIS-KE': kenyaConfig,
    'CHIS-TG': togoConfig,
    'CHIS-CIV': civConfig,
    'CHIS-ML': maliConfig,
    DEFAULT: defaultConfig
  };

  constructor() {
    this.filePath = path.join(this.getConfigUploadDirectory(), 'config.json');
  }

  static getConfigFactory(): ConfigFactory {
    if (!ConfigFactory.configFactoryInstance) {
      ConfigFactory.configFactoryInstance = new ConfigFactory();
    }

    return ConfigFactory.configFactoryInstance as ConfigFactory;
  }

  loadConfig(key?: string): PartnerConfig {

    if (this.config) {
      return this.config;
    }

    if (fs.existsSync(this.filePath)) {
      this.config = this.readConfig();
      console.log(`Using uploaded configuration: ${this.filePath}`);
      return this.config;
    }

    //set default config
    if (!key) {
      console.log('no configuration found. Setting to default');
      const defaultConfig = this.DEFAULT_CONFIG_MAP.DEFAULT;
      return this.config = defaultConfig;
    }

    const usingKey = key.toUpperCase();
    console.log(`Using configuration: ${key}`);
    const result = this.DEFAULT_CONFIG_MAP[usingKey];
    if (!result) {
      const available = JSON.stringify(Object.keys(this.DEFAULT_CONFIG_MAP));
      throw Error(`Failed to start: Cannot find configuration "${usingKey}". Configurations available are ${available}`);
    }

    this.config = result;
    return this.config;

  }

  refreshConfig(config: PartnerConfig): PartnerConfig {
    if (fs.existsSync(this.filePath)) {
      this.config = this.readConfig();
      console.log(`Configuration refreshed: ${this.filePath}`);
      return this.config;
    }
    return this.config = config;
  }

  writeConfig(config: ConfigSystem): void {
    try {
      const jsonString: string = JSON.stringify(config, null, 2);
      fs.writeFileSync(this.filePath, jsonString);
      this.refreshConfig({ config });
    } catch (error) {
      throw new Error('writeConfig: Failed to write file');
    }
  }

  private getConfigUploadDirectory(): string {
    const configDir = path.join(__dirname, '..', 'config_uploads');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir);
    }
    return configDir;
  }

  private readConfig(): PartnerConfig {
    try {
      const fileContent = fs.readFileSync(this.filePath, 'utf-8');

      const config = JSON.parse(fileContent);
      return { config };
    } catch (error) {
      console.error('readConfig:Failed to read config file:', error);
      throw error;
    }
  }
}
