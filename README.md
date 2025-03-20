# CHT User Management Tool

## Goal

A simple user-facing web application using [CHT's API](https://docs.communityhealthtoolkit.org/apps/reference/api/) that supports user management needs for CHT projects at scale.

## eCHIS Kenya Training Videos

* [Creating a New User in CHIS User Management Tool](https://www.loom.com/share/4504606894bc4013bda940f2b360e546)
* [Replacing an Existing Community Health Promoter using the User Management Tool](https://www.loom.com/share/0dc7881611664d7b8cbd6c810f95035b)
* [How to Replace a CHA Using the User Management Tool](https://www.loom.com/share/d7fcf91390f9453980f07223c8a16709)
* [Bulk Uploading Users with the User Management Tool](https://www.loom.com/share/c50b023988d34d95b61338ead4fab59b)
* [Moving an Existing Place with the User Management Tool](https://www.loom.com/share/cd9e98aefedb490fae61775c86b9b6fe)
* [CHIS Kenya - CHA Changing a Phone Number for a CHP](https://www.loom.com/share/8a0f629161944567b6ca504ab27ec6cf)
* [How to Bulk Replace CHPs with CHIS User Management Tool](https://www.loom.com/share/33d9395a515741fa9620f7004578de24)
* [How to Resolve eCHIS-KE Logic Error](https://www.loom.com/share/80e130733d094e4a829bdfe063d8b1e6)

For Developers:
* [Running CHT User Management Tool with a Local CHT Instance](https://www.loom.com/share/645cf995a9c44a5ab843628538a019ff)

## Using this tool with your CHT Project

To use the User Management Tool with your CHT project, you'll need to create a new project configuration folder and follow some deployment steps.

### Configuration

1. Create a new folder in `src/config`.
2. Create a `config.json` file and specify the values as defined below.
3. Add reference to your configuration folder in `src/config/config-factory.ts`.

 Property | Type | Description
-- | -- | --
`domains` | Array | Controls the list of instances which the user can login to
`domains.friendly` | string | Friendly name for the instance (eg. "Migori")
`domains.domain` | string | Hostname for the instance (eg. "migori-echis.health.go.ke")
`domains.useHttp` | boolean | Whether to make an insecure connection (http) to the hostname (defaults to false)
`contact_types` | Array | One element for each type of user which can be created by the system
`contact_types.name` | string | The name of the contact_type as it [appears in the app's base_settings.json](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/hierarchy/)
`contact_types.friendly` | string | Friendly name of the contact type
`contact_types.contact_type` | string | The contact_type of the primary contact. [As defined in base_settings.json](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/hierarchy/)
`contact_types.contact_friendly` | string | Friendly name of the primary contact type
`contact_types.user_role` | string[] | A list of allowed [user roles](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/user-roles/). If only one is provided, it will be used by default.
`contact_types.username_from_place` | boolean | When true, the username is generated from the place's name. When false, the username is generated from the primary contact's name. Default is false.
`contact_types.hierarchy` | Array<ConfigProperty> | Defines how this `contact_type` is connected into the hierarchy. An element with `level:1` (parent) is required and additional elements can be provided to support disambiguation. See [ConfigProperty](#ConfigProperty).
`contact_types.hierarchy.level` | integer | The hierarchy element with `level:1` is the parent, `level:3` is the great grandparent.
`contact_types.replacement_property` | Property | Defines how this `contact_type` is described when being replaced. The `property_name` is always `replacement`. See [ConfigProperty](#ConfigProperty).
`contact_types.place_properties` | Array<ConfigProperty> | Defines the attributes which are collected and set on the user's created place. See [ConfigProperty](#ConfigProperty).
`contact_types.contact_properties` | Array<ConfigProperty> | Defines the attributes which are collected and set on the user's primary contact doc. See [ConfigProperty](#ConfigProperty).
`contact_types.deactivate_users_on_replace` | boolean | Controls what should happen to the defunct contact and user documents when a user is replaced. When `false`, the contact and user account will be deleted. When `true`, the contact will be unaltered and the user account will be assigned the role `deactivated`. This allows for account restoration.
`contact_types.hint` | string | Provide a brief hint or description to clarify the expected input for the property.
`contact_types.can_assign_multiple` | boolean | Requires CHT >=4.9.0. Enable support for assigning a single user to multiple places.
`contact_types.superset_properties` | Object | Configuration for [Superset integration](#superset-configuration). Optional - if not provided, Superset integration is disabled for this contact type. When provided, enables runtime control of Superset integration through forms or CSV uploads.
`logoBase64` | Image in base64 | Logo image for your project

#### ConfigProperty
The `ConfigProperty` is a data structure used several times each `config.json` file. At a high level, a `ConfigProperty` defines a property on an object.

Property | Type | Description
-- | -- | --
friendly_name | string | Defines how this data will be labeled in CSV files and throughout the user experience.
property_name | string | Defines how the value will be stored on the object.
type | ConfigPropertyType | Defines the validation rules, and auto-formatting rules. See [ConfigPropertyType](#ConfigPropertyType).
parameter | any | See [ConfigPropertyType](#ConfigPropertyType).
required | boolean | True if the object should not exist without this information.
unique | 'all' or 'parent' | Dismissable warnings are flagged if a place already exists with this attribute's value. Values can be `all` (warns if any place has the same value) or `parent` (warns if a place with the same parent has the same value). This can only be defined on a `place_properties` or `contact_properties`.

#### ConfigPropertyType
The `ConfigPropertyType` defines a property's validation rules and auto-formatting rules. The optional `parameter` information alters the behavior of the `ConfigPropertyType`.

| Type      | Validation Rules                                       | Auto Formatting Rules                                               | Validator                                                                                              | parameter     |
|-----------|--------------------------------------------------------|---------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|---------------|
| string    | Must be defined                                        | Removes double whitespaces, leading or trailing whitespaces, and any character which is not alphanumeric or ` ()\-'` | None                                                                                                   |
| name      | Must be defined                                        | Same as string + title case + `parameter` behavior                  | One or more regexes which are removed from the value when matched (eg. `"parameter": ["\\sCHU"]` will format `this CHU` into `This`) |
| regex     | Must match the `regex` captured by `parameter`         | Same as `string`                                                    | A regex which must be matched to pass validation (eg. `"parameter": "^\\d{6}$"` will accept only 6 digit numbers)     |
| phone     | A valid phone number for the specified locality        | Auto formatting provided by [libphonenumber](https://github.com/google/libphonenumber)          | Two letter country code specifying the locality of phone number (eg. `"parameter": "KE"`)             |
| generated | None. No user inputs.                                  | Uses [LiquidJS](https://liquidjs.com) templates to generate data    | None                                                                                                   | [Details](#The-Generated-ConfigPropertyType)
| select_one      | Single choice from a list of options            | Same as `string`                                                                                               | None                                                                                                   | Dictionary where the keys are the option values and the values are the corresponding labels |
| select_multiple | Multiple choice from a list of options          | Same as `string`                                                                                               | None                                                                                                   | Same as `select_one`    
| none      | None                                                   | None                                                                | None                                                                                                   |

#### The Generated ConfigPropertyType
ContactProperties with `type: "generated"` use the [LiquidJS](https://liquidjs.com) template engine to populate a property with data. Here is an example of some configuration properties which use `"type": "generated"`:

```json
{
  "place_properties": [
    {
      "friendly_name": "CHP Area Name",
      "property_name": "name",
      "type": "generated",
      "parameter": "{{ contact.name }}'s Area",
      "required": true
    }
  ],
  "contact_properties": [
    {
      "friendly_name": "CHP Name",
      "property_name": "name",
      "type": "name",
      "required": true
    }
  ]
}
```

The user will be prompted to input the contact's name (CHP Name). The user is _not_ prompted to input the place's name (CHP Area Name) because the place's name will automatically be assigned a value.  In this example, if the user puts `john` as the contact's name, then the place will be named `John's Area`.

The data that is passed to the template is consistent with the properties defined in your configuration.

Variable | Value
-- | --
place | Has the attributes from `place_properties.property_name` 
contact | Has the attributes from `contact_properties.property_name`
lineage | Has the attributes from `hierarchy.property_name` 

#### Superset Configuration

The CHT User Management Tool supports integration with Apache Superset, allowing automatic user creation and access management in both CHT and Superset. 
The `superset_properties` object in a contact type enables Superset integration:

```json
{
  "contact_types": [
    {
      "name": "c_community_health_unit",
      // ...
      "superset": {
        "friendly_name": "Superset Integration",
        "property_name": "superset_config",
        "type": "select_one",
        "parameter": {
          "disable": "Disable",
          "enable": "Enable"
        },
        "required": false,
        "prefix": "[]",
        "role_template": "[]",
        "rls_template": "[]",
        "rls_group_key": "[]"
      }
    }
  ]
}
```

##### Superset Integration Requirements

1. **Configuration Level (Contact Type Setting)**:
   - The `superset` property in the contact type configuration determines if Superset integration is available
   - If not set in the configuration, Superset integration is completely disabled for that contact type
   - When set in the configuration, it enables the option to create Superset accounts during user creation

2. **Runtime Control (Per-User Setting)**:
   - Only available if Superset is configured for the contact type
   - Controls whether a Superset account is created for each specific user
   - Can be controlled through:
     - A dropdown in the web interface form when creating/editing places
     - The `superset_config` column in CSV uploads (values: "enable" or "disable")
   - Effects when enabled for a user:
     - Email becomes a required field for the contact
     - A Superset account is created during upload
     - Role and permissions are set up in Superset
   - Effects when disabled for a user:
     - Email is optional
     - No Superset account or resources are created
     - User only gets CHT access

##### Superset Upload Process

When Superset integration is enabled for a place:

1. The CHT upload is performed first
2. If CHT upload succeeds and Superset is enabled for the place:
   - Creates a role in Superset for the CHU
   - Assigns necessary permissions from a template role
   - Sets up row-level security for the CHU's data
   - Creates a Superset user with appropriate access

##### Superset Upload States

Places track their upload state separately for CHT and Superset:
- `chtUploadState`: Tracks the CHT upload status
- `supersetUploadState`: Tracks the Superset upload status

Both can be in one of these states:
- `NOT_ATTEMPTED`: Upload hasn't been tried yet
- `PENDING`: Upload is in progress
- `SUCCESS`: Upload completed successfully
- `FAILURE`: Upload failed

##### Superset Error Handling

- If CHT upload fails, Superset upload is not attempted
- If Superset upload fails, it can be retried without affecting the CHT upload
- Each system maintains its own error state and can be retried independently

##### Superset Integration deployment
Superset integration requires specific environment variables for each configuration. See [Superset Environment Variables](#superset-environment-variables) for the required variables and naming convention.

For production deployment, Superset credentials are managed securely using SOPS encryption. See the [Medic Deployment Guide](scripts/deploy/medic-deploy.md#managing-superset-secrets) for detailed instructions.


### Deployment
This tool is available via Docker by running `docker compose up`. Set the [Environment Variables](#environment-variables).

## Development

### NodeJs with reloading code

Create an environment file by `cp env.example .env`. Change `INTERFACE` to `127.0.0.1` and otherwise see [Environment Variables](#environment-variables) for more info.

If you don't have redis running locally, you can start it with:

```shell
docker compose -f docker-compose.redis.yml up -d
```

Then run:

```
npm run dev
```

or

```
npm run build
npm start
```

### Docker with static code

To build the Docker images and run Docker Compose locally, run:

```bash
./docker-local-setup.sh build
```

If you just need to run the development environment without rebuilding the images run:

```bash
./docker-local-setup.sh
```

## Environment Variables

The `env.example` file has example values.  Here's what they mean:

Variable | Description | Sample
-- | -- | --
`CONFIG_NAME` | Name of the configuration to use | `chis-ke`
`EXTERNAL_PORT` | Port to use in docker compose when starting the web server | `3500`
`PORT` | For localhost development environment | `3500`
`COOKIE_PRIVATE_KEY` | A string used to two-way encryption of main app cookies. Production values need to be a secret. Suggest `uuidgen` to generate | `589a7f23-5bb2-4b77-ac78-f202b9b6d5e3`
`WORKER_PRIVATE_KEY` | A string used to two-way encryption sensitive data passed to workers. Recommend to be different from `COOKIE_PRIVATE_KEY`. Production values need to be a secret. Suggest `uuidgen` to generate | `2b57pd5e-f272-og90-8u97-89a7589a7f23`
`INTERFACE` | Interface to bind to. Leave as '0.0.0.0' for prod, suggest '127.0.0.1' for development | `127.0.0.1`
`CHT_DEV_URL_PORT` | CHT instance when in `NODE_ENV===dev`. Needs URL and port | `192-168-1-26.local-ip.medicmobile.org:10463`
`CHT_DEV_HTTP` |  'true' for http  'false' for https | `false`
`REDIS_HOST` | Redis server hostname use 'redis' for docker | `redis`
`REDIS_PORT` | Redis server port | `6379`
`CHT_USER_MANAGEMENT_IMAGE` | docker image for cht-user-management service (local development), leave empty to use published one | `cht-user-management:local `
`CHT_USER_MANAGEMENT_WORKER_IMAGE` | docker image for cht-user-management service (local development), leave empty to use published one | `cht-user-management-worker:local`

### Superset Environment Variables

For each configuration (e.g., `chis-ke`, `chis-tg`), the following environment variables are required for Superset integration. Since these contain sensitive credentials, for production deployments they should be managed using SOPS as described in the [Managing Additional Secrets](scripts/deploy/medic-deploy.md#managing-additionnal-secrets) section of the deployment documentation:

Variable | Description | Sample
-- | -- | --
`{CONFIG_NAME}_SUPERSET_BASE_URL` | Superset instance URL for this config | `CHIS_KE_SUPERSET_BASE_URL=https://superset.example.com`
`{CONFIG_NAME}_SUPERSET_ADMIN_USERNAME` | Superset admin username for this config | `CHIS_KE_SUPERSET_ADMIN_USERNAME=admin`
`{CONFIG_NAME}_SUPERSET_ADMIN_PASSWORD` | Superset admin password for this config | `CHIS_KE_SUPERSET_ADMIN_PASSWORD=password123`

Note: Replace `{CONFIG_NAME}` with your configuration name in uppercase with hyphens replaced by underscores (e.g., `CHIS_KE` for `chis-ke`).

## Publishing new docker images

Docker images are hosted on [AWS's Elastic Container Registry (ECR)](https://gallery.ecr.aws/medic/cht-user-management). To publish a new version:

1. Update the [version string](https://github.com/medic/cht-user-management/blob/d992d5d6a911cdc21f610fa48a0ffb3e275bae0d/package.json#L3) in the `package.json`.
2. Submit a PR and have it merged to `main`. 
3. [Existing CI](https://github.com/medic/cht-user-management/blob/main/.github/workflows/docker-build.yml) will push an image to ECR.
