# CHT User Management Tool

## Goal

A simple user-facing web application using [CHT's API](https://docs.communityhealthtoolkit.org/apps/reference/api/) that supports user management needs for CHT projects at scale.

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
`contact_types.user_role` | string | The [role](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/user-roles/) of the user which is created
`contact_types.username_from_place` | boolean | When true, the username is generated from the place's name. When false, the username is generated from the primary contact's name. Default is false.
`contact_types.hierarchy` | Array<ConfigProperty> | Defines how this `contact_type` is connected into the hierarchy. An element with `level:1` (parent) is required and additional elements can be provided to support disambiguation. See [ConfigProperty](#ConfigProperty).
`contact_types.hierarchy.level` | integer | The hierarchy element with `level:1` is the parent, `level:3` is the great grandparent.
`contact_types.replacement_property` | Property | Defines how this `contact_type` is described when being replaced. The `property_name` is always `replacement`. See [ConfigProperty](#ConfigProperty).
`contact_types.place_properties` | Array<ConfigProperty> | Defines the attributes which are collected and set on the user's created place. See [ConfigProperty](#ConfigProperty).
`contact_types.contact_properties` | Array<ConfigProperty> | Defines the attributes which are collected and set on the user's primary contact doc. See [ConfigProperty](#ConfigProperty).
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

#### ConfigPropertyType
The `ConfigPropertyType` defines a property's validation rules and auto-formatting rules. The optional `parameter` information alters the behavior of the `ConfigPropertyType`.

Type | Validation Rules | Auto Formatting Rules | Validator | parameter
-- | -- | -- | --
string | Must be defined | Removes double whitespaces, leading or trailing whitespaces, and any character which is not alphanumeric or ` ()\-'` | None
name | Must be defined | Same as string + title case + `parameter` behavior | One or more regexes which are removed from the value when matched (eg. `"parameter": ["\\sCHU"]` will format `This Unit` into `This`)
regex | Must match the `regex` captured by `parameter` | Same as `string` | A regex which must be matched to pass validation (eg. `"parameter": "^\\d{6}$"` will accept only 6 digit numbers)
phone | A valid phone number for the specified locality | Auto formatting provided by [libphonenumber](https://github.com/google/libphonenumber) | Two letter country code specifying the locality of phone number (eg. `"parameter": "KE"`)
none | None | None | None
gender | A binary gender (eg. `Male`, `Woman`, `M`) | Formats to either `Male` or `Female` | None

### Deployment
This tool is available via Docker by running `docker compose up`. Set the [Environment Variables](#environment-variables).

## Development
Create a `.env` file. Check out the `env.example` to get started. See [Environment Variables](#environment-variables).

Then run

```
npm run dev
```

or

```
npm run build
npm start
```

## Environment Variables

The `env.example` file has example values.  Here's what they mean:

Variable | Description
-- | --
`CONFIG_NAME` | Name of the configuration to use (eg. "CHIS-KE")
`EXTERNAL_PORT` | Port to use when starting the web server
`COOKIE_PRIVATE_KEY` | A string used to two-way encryption of cookies. Production values need to be a secret.

## Publishing new docker images

Docker images are hosted on [AWS's Elastic Container Registry (ECR)](https://gallery.ecr.aws/medic/cht-user-management). To publish a new version:

1. Update the [version string](https://github.com/medic/cht-user-management/blob/d992d5d6a911cdc21f610fa48a0ffb3e275bae0d/package.json#L3) in the `package.json`.
2. Submit a PR and have it merged to `main`. 
3. [Existing CI](https://github.com/medic/cht-user-management/blob/main/.github/workflows/docker-build.yml) will push an image to ECR.
