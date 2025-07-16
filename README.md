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
`contact_types.superset_properties` | Object | See [Superset Integration](#superset-integration) for configuration and requirements.
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

## Superset Integration

The CHT User Management Tool supports integration with Apache Superset, allowing automatic user creation and access management in both CHT and Superset.

### Configuration

- To enable Superset integration for a contact type, add a `superset` property to the contact type in your `config.json`.
- The `contact_properties` array **must include an `email` property with `"required": true`**.
- Example:

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
        "role_template": <ROLE_ID>,
        "rls_template": <RLS_ID>,
        "rls_group_key": "[]"
      }
    }
  ]
}
```

- `role_template` and `rls_template` should be set to the IDs of a template role and RLS in your Superset instance. New users at this contact type level will copy role permissions and RLS config from these templates.

### Environment Variables

See the [Environment Variables](#environment-variables) table above for the required Superset variables. Replace `{CONFIG_NAME}` with your configuration name in uppercase with hyphens replaced by underscores (e.g., `CHIS_KE` for `chis-ke`).

- In development, set these in your `.env` file.
- In production, add them to your Helm chart's `values.yaml`. If you don't want to have them visible in your repo, encrypt as described in the [Managing Additional Secrets](#managing-additional-secrets) section.

### How Superset Integration Works

- If Superset integration is enabled for a contact type, users created for that type can also be provisioned in Superset.
- The Superset integration can be toggled per user (via form or CSV) if the `superset` property is present.
- When enabled for a user:
  - Email is required.
  - The tool creates a Superset user, role, and RLS, copying from the templates you provided.
- When disabled for a user:
  - Email is optional.
  - No Superset account or resources are created.

#### Upload Process
1. CHT upload is performed first.
2. If successful and Superset is enabled for the user:
   - Creates a role in Superset for the CHU.
   - Assigns permissions from the template role.
   - Sets up row-level security from the template RLS.
   - Creates a Superset user with appropriate access.

#### Upload States
- `chtUploadState`: Tracks the CHT upload status.
- `supersetUploadState`: Tracks the Superset upload status.
- Both can be: `NOT_ATTEMPTED`, `PENDING`, `SUCCESS`, `FAILURE`.

#### Error Handling
- If CHT upload fails, Superset upload is not attempted.
- If Superset upload fails, it can be retried without affecting the CHT upload.
- Each system maintains its own error state and can be retried independently.

### How to Test Superset Integration

1. **Have a running Superset instance** ([installation guide](https://superset.apache.org/docs/installation/installing-superset/)).
2. **Create a template role and RLS in Superset**. Note their IDs and set them in your `config.json` under the relevant contact type's `superset` property as `role_template` and `rls_template`.
3. **Set environment variables** for your config (see above).
4. **Ensure your contact type config includes a required `email` property** in `contact_properties`.
5. **Run the tool and create a user with Superset integration enabled**. The tool will copy role and RLS from your templates and create the user in Superset.
6. **Verify in Superset**: Log in as admin and check that the user, roles, and permissions were created as expected.

If Superset integration fails, check logs, environment variables, and Superset connectivity. For production, ensure secrets are properly decrypted and available as environment variables.

## Managing Secrets

See [scripts/deploy/medic-deploy.md](scripts/deploy/medic-deploy.md#managing-secrets) for detailed instructions on managing secrets for both Medic-hosted and self-hosted deployments, including SOPS usage, what to commit, and how CI/CD handles secrets.

### Deployment
This tool is available via Docker by running `docker compose up`. Set the [Environment Variables](#environment-variables).

## Development

### NodeJs with reloading code

Create an environment file by `cp env.example .env`. Change `INTERFACE` to `127.0.0.1` and otherwise see [Environment Variables](#environment-variables) for more info.

If you don't have redis running locally, you can start it with:

```shell
docker compose -f docker-compose.redis.yml up -d
```

Run these two commands  first to ensure the `./dist` folder is properly populated  and all required packages are installed:

```shell
npm ci
npm run build
```

Then run this to start a local dev instance and reload the app when it sees changes to local files:

```shell
npm run dev
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
`ALLOW_ADMIN_LOGIN` |  Allow login for admin accounts. Defaults to true. | `true`
`REDIS_HOST` | Redis server hostname use 'redis' for docker | `redis`
`REDIS_PORT` | Redis server port | `6379`
`CHT_USER_MANAGEMENT_IMAGE` | docker image for cht-user-management service (local development), leave empty to use published one | `cht-user-management:local `
`CHT_USER_MANAGEMENT_WORKER_IMAGE` | docker image for cht-user-management service (local development), leave empty to use published one | `cht-user-management-worker:local`
`{CONFIG_NAME}_SUPERSET_BASE_URL` | Superset instance URL for this config | `CHIS_KE_SUPERSET_BASE_URL=https://superset.example.com`
`{CONFIG_NAME}_SUPERSET_ADMIN_USERNAME` | Superset admin username for this config | `CHIS_KE_SUPERSET_ADMIN_USERNAME=admin`
`{CONFIG_NAME}_SUPERSET_ADMIN_PASSWORD` | Superset admin password for this config | `CHIS_KE_SUPERSET_ADMIN_PASSWORD=password123`

## Publishing new docker images
## Development

This repo has an automated release process where each feature/bug fix will be released immediately after it is merged to main.

1. Create a ticket for the feature/bug fix.
2. Submit a PR, and make sure that the PR title is clear, readable, and follows the strict commit message format described in the commit message format section below. If the PR title does not comply, automatic release will fail.
3. Have the PR reviewed.
4. Squash and merge the PR to main. The commit message should be the already-formatted PR title but double check it's clear, readable, and follows the strict commit message format to make sure the automatic release works as expected.
5. Close the ticket.

New docker images are published after every release and are hosted on [AWS's Elastic Container Registry (ECR)](https://gallery.ecr.aws/medic/cht-user-management). 

### Commit message format

The commit format should follow the convention outlined in the [CHT docs](https://docs.communityhealthtoolkit.org/contribute/code/workflow/#commit-message-format).
Examples are provided below.

| Type        | Example commit message                                                                              | Release type |
|-------------|-----------------------------------------------------------------------------------------------------|--------------|
| Bug fixes   | fix(#123): infinite spinner when clicking contacts tab twice                                        | patch        |
| Performance | perf(#789): lazily loaded angular modules                                                           | patch        |
| Features    | feat(#456): add home tab                                                                            | minor        |
| Non-code    | chore(#123): update README                                                                          | none         |
| Breaking    | perf(#2): remove reporting rates feature <br/> BREAKING CHANGE: reporting rates no longer supported | major        |
