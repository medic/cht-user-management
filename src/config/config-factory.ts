import { Config, ConfigSystem, PartnerConfig } from '.';
import ugandaConfig from './chis-ug';
import kenyaConfig from './chis-ke';
import togoConfig from './chis-tg';
import civConfig from './chis-civ';
import path from 'path';
import fs from 'fs';

export const uploadedConfigFilePath: string = path.join(getConfigUploadDirectory(), 'config.json');


export const DEFAULT_CONFIG_MAP: { [key: string]: PartnerConfig } = {
  'CHIS-KE': kenyaConfig,
  'CHIS-UG': ugandaConfig,
  'CHIS-TG': togoConfig,
  'CHIS-CIV': civConfig
};

export default async function getConfigByKey(key: string = 'CHIS-KE'): Promise<PartnerConfig> {
  if (fs.existsSync(uploadedConfigFilePath)) {
    const uploadedConfig = await readConfig();
    await Config.assertValid(uploadedConfig);
    console.log(`Using uploaded configuration: ${uploadedConfigFilePath}`);
    return uploadedConfig;
  }

  const usingKey = key.toUpperCase();
  console.log(`Using configuration: ${key}`);
  const result = DEFAULT_CONFIG_MAP[usingKey];
  if (!result) {
    const available = JSON.stringify(Object.keys(DEFAULT_CONFIG_MAP));
    throw Error(`Failed to start: Cannot find configuration "${usingKey}". Configurations available are ${available}`);
  }

  return result;
}

export function getConfigUploadDirectory (): string {
  const configDir = path.join(__dirname, '..', 'config_uploads');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir);
  }
  return configDir;
}

export async function writeConfig(jsonConfigData: ConfigSystem): Promise<void> {
  try {
    const jsonString: string = JSON.stringify(jsonConfigData, null, 2);
    await fs.promises.writeFile(uploadedConfigFilePath, jsonString);
  } catch (error) {
    throw new Error('writeConfig: Failed to write file');
  }
}

export async function readConfig(): Promise<PartnerConfig> {
  try {
    const fileContent = await fs.promises.readFile(uploadedConfigFilePath, 'utf-8');

    const config = JSON.parse(fileContent);
    return { config };
  } catch (error) {
    console.error('readConfig:Failed to read config file:', error);
    throw error;
  }
}
