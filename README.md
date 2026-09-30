# CHT User Management Tool

## Goal

A simple user-facing web application using [CHT's API](https://docs.communityhealthtoolkit.org/apps/reference/api/) that supports user management needs for CHT projects at scale: creating users, replacing who is behind a place, and moving, merging and deleting places, one at a time or in bulk from CSV files.

How the tool works, and why, is described in [`docs/`](docs):

* [`docs/APP.md`](docs/APP.md): the design, operation by operation
* [`docs/api-contract.md`](docs/api-contract.md): the HTTP API
* [`docs/frontend-contract.md`](docs/frontend-contract.md): the screens and the API calls they make
* [`docs/legacy/`](docs/legacy): the previous version's README, deployment values and example settings

## Using this tool with your CHT Project

To use the User Management Tool with your CHT project, you'll need a deployment folder for your project, then follow the deployment steps.

### Configuration

Everything specific to a project lives in one folder, named by the [`DEPLOYMENT_DIR`](#environment-variables) environment variable. The folders in [`config/deployments/`](config/deployments) (`chis-ke`, `chis-tg`, `chis-civ`, `chis-ml` and `chis-ug`) are examples, and any folder with the same files works:

File | Required | Description
-- | -- | --
`config.json` | Yes | The contact types the tool manages. See [config.json](#configjson)
`instances.json` | Yes | The CHT instances users can log in to. See [instances.json](#instancesjson)
`logo.png` | No | Logo shown on the login page and navigation bar. `logo.jpg`, `logo.svg` or `logo.webp` also work
Hook scripts | No | Scripts listed in a contact type's `hooks`. See [Hooks](#hooks)

The folder is read when the server starts, and the server refuses to start if a file is missing or malformed.

#### config.json

 Property | Type | Description
-- | -- | --
`contact_types` | Array | One element for each type of place the tool manages
`contact_types.name` | string | The name of the contact_type as it [appears in the app's base_settings.json](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/hierarchy/)
`contact_types.friendly` | string | Friendly name of the contact type
`contact_types.contact_type` | string | The contact_type of the primary contact. [As defined in base_settings.json](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/hierarchy/)
`contact_types.contact_friendly` | string | Friendly name of the primary contact type
`contact_types.user_role` | string[] | A list of allowed [user roles](https://docs.communityhealthtoolkit.org/apps/reference/app-settings/user-roles/). If only one is provided, it will be used by default.
`contact_types.username_from_place` | boolean | When true, the username is generated from the place's name. When false, the username is generated from the primary contact's name. Default is false.
`contact_types.hierarchy` | Array<ConfigProperty> | Defines how this `contact_type` is connected into the hierarchy. An element with `level:1` (parent) is required and additional elements can be provided to support disambiguation. See [ConfigProperty](#configproperty).
`contact_types.hierarchy.level` | integer | The hierarchy element with `level:1` is the parent, `level:3` is the great grandparent.
`contact_types.hierarchy.contact_type` | string | The contact_type of the place at that level
`contact_types.replacement_property` | ConfigProperty | Defines how this `contact_type` is described when being replaced, and how a CSV row's name is matched to a place when moving, merging or deleting. The `property_name` is always `replacement`. See [ConfigProperty](#configproperty).
`contact_types.place_properties` | Array<ConfigProperty> | Defines the attributes which are collected and set on the user's created place. See [ConfigProperty](#configproperty).
`contact_types.contact_properties` | Array<ConfigProperty> | Defines the attributes which are collected and set on the user's primary contact doc. See [ConfigProperty](#configproperty).
`contact_types.deactivate_users_on_replace` | boolean | Controls what happens to the outgoing person's user account when a place is replaced and the account is left with no places. When `false`, the account is disabled. When `true`, it is deactivated, which allows for account restoration. Either way, the outgoing person's contact is kept, with their reports.
`contact_types.can_assign_multiple` | boolean | Enable support for assigning a single user to multiple places
`contact_types.actions` | string[] | Optional. The only actions offered for this type, from `create`, `replace`, `move`, `merge` and `delete`. Every action is offered when left out. eg. `["move"]` for households, which can only be moved.
`contact_types.hooks` | string[] | Optional. Scripts in the deployment folder that adjust this type's places before they're written. See [Hooks](#hooks).

#### ConfigProperty
The `ConfigProperty` is a data structure used several times in each `config.json` file. At a high level, a `ConfigProperty` defines a property on an object.

Property | Type | Description
-- | -- | --
friendly_name | string | Defines how this data will be labeled in CSV files and throughout the user experience.
property_name | string | Defines how the value will be stored on the object.
type | ConfigPropertyType | Defines the validation rules, and auto-formatting rules. See [ConfigPropertyType](#configpropertytype).
parameter | any | See [ConfigPropertyType](#configpropertytype).
required | boolean | True if the object should not exist without this information.
errorDescription | string | Optional. Shown under the field, and as the error when a `regex` value doesn't match.
unique | 'all' or 'parent' | Dismissable warnings are flagged if a place already exists with this attribute's value. Values can be `all` (warns if any place has the same value) or `parent` (warns if a place with the same parent has the same value). This can only be defined on a `place_properties` or `contact_properties`.

#### ConfigPropertyType
The `ConfigPropertyType` defines a property's validation rules and auto-formatting rules. The optional `parameter` information alters the behavior of the `ConfigPropertyType`.

| Type            | Validation Rules                                       | Auto Formatting Rules                                                                                          | parameter |
|-----------------|--------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|-----------|
| string          | Must be defined                                        | Removes double whitespaces, leading or trailing whitespaces, and any character which is not a letter, digit, mark, space or `()@./-_'` | None |
| name            | Must be defined                                        | Same as string + `.` becomes a space + title case (keeping roman numerals upper case) + `parameter` behavior  | One or more regexes which are removed from the value when matched (eg. `"parameter": ["\\sCHU"]` will format `this CHU` into `This`) |
| regex           | Must match the `regex` captured by `parameter`         | Same as `string`                                                                                               | A regex which must be matched to pass validation (eg. `"parameter": "^\\d{6}$"` will accept only 6 digit numbers) |
| phone           | A valid phone number for the specified locality       | Auto formatting provided by [libphonenumber](https://github.com/google/libphonenumber)                          | Two letter country code specifying the locality of phone number (eg. `"parameter": "KE"`) |
| dob             | An ISO date, `d/M/yyyy`, or an age in years; in the past | Stored as an ISO date                                                                                        | None |
| generated       | None. No user inputs.                                  | Filled in from a template of other values                                                                   | [Details](#the-generated-configpropertytype) |
| select_one      | Single choice from a list of options                   | None                                                                                                           | Dictionary where the keys are the option values and the values are the corresponding labels |
| select_multiple | Multiple choice from a list of options                 | None                                                                                                           | Same as `select_one` |
| none            | None                                                   | None                                                                                                           | None |

#### The Generated ConfigPropertyType
ContactProperties with `type: "generated"` are filled in from a template, whose `{{ … }}` placeholders are replaced by other values. Here is an example of some configuration properties which use `"type": "generated"`:

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

The placeholders are `{{ place.<property_name> }}`, `{{ contact.<property_name> }}` and `{{ lineage.<property_name> }}`, each replaced by that value, or by nothing when it has none. Filters and tags aren't supported, and the tool refuses to start if a template uses them.

Variable | Value
-- | --
place | Has the attributes from `place_properties.property_name`
contact | Has the attributes from `contact_properties.property_name`
lineage | Has the attributes from `hierarchy.property_name`

#### Password reset on first login

Introduced in CHT v4.17 https://docs.communityhealthtoolkit.org/building/login/#password-reset-on-first-login
This can be configured by adding this to your contact properties

```json
{
  "contact_properties": [
    {
      "friendly_name": "Require password change",
      "property_name": "require_password_change",
      "type": "select_one",
      "required": false,
      "parameter": {
        "yes": "Yes",
        "no": "No"
      }
    }
  ]
}
```

#### instances.json

The CHT instances users can log in to, listed on the login page in order of their host.

```json
{
  "instances": [
    { "id": "migori", "name": "Migori", "host": "migori.echis.go.ke", "idpOrigins": ["https://chwregistry.echis.go.ke"] }
  ]
}
```

Property | Type | Description
-- | -- | --
`instances.id` | string | Identifier for the instance: lowercase letters, digits and dashes (eg. `migori`)
`instances.name` | string | Friendly name for the instance (eg. "Migori")
`instances.host` | string | Hostname for the instance, with an optional port and no scheme (eg. `migori.echis.go.ke`)
`instances.useHttp` | boolean | Whether to make an insecure connection (http) to the host (defaults to false)
`instances.idpOrigins` | string[] | Origins of the identity providers allowed to sign users in with SSO. SSO is off when empty (the default)

#### Hooks

A hook is a script, in the deployment folder, that adjusts a place before it's written, for rules that configuration can't express. A contact type lists its hooks in `hooks`, and they run in that order, when the place is uploaded. Each script exports a `mutate` function:

```js
// config/deployments/chis-ke/hooks/unit-name.mjs
export async function mutate(draft, { cht, contactType, isReplacement }) {
	if (draft.name) draft.name += ' Community Health Unit';
}
```

`draft` is the place doc to change. `cht` is the tool's CHT client, to read related docs, `contactType` is the place's type from `config.json`, and `isReplacement` is true when its primary contact is being replaced. Throwing an `Error` refuses the upload, and its message is shown on the item. Hooks run code from the configuration, so only the people who deploy the tool should be able to change the folder.

### Deployment
This tool is available via Docker by running `docker compose up -d --build`, which starts the tool and its Redis. Set the [Environment Variables](#environment-variables) in a `.env` file first; Compose sets `REDIS_URL` and the port inside the container itself.

The deployment folders in `config/deployments/` are included in the image, so `DEPLOYMENT_DIR` can name one of them, eg. `config/deployments/chis-ke`. For another project, mount its folder into the container and point `DEPLOYMENT_DIR` at it. Keep `/app/data` on a volume, since it holds the copies of deleted places that undoing a delete needs.

The image can also be run on its own, with a Redis the container can reach:

```shell
docker build -t cht-user-management .
docker run -d -p 3000:3000 --env-file .env -v cht-user-management-data:/app/data cht-user-management
```

`GET /_healthz` answers `200` once the tool is up, for container and Kubernetes health checks.

## Development

### NodeJs with reloading code

Create an environment file by `cp .env.example .env`, fill in the keys, and otherwise see [Environment Variables](#environment-variables) for more info. To log in to a CHT running on your machine, set `CHT_DEV_INSTANCE`.

If you don't have redis running locally, you can start it with:

```shell
docker compose -f docker-compose.redis.yml up -d
```

Install the packages, then start a local dev instance that reloads the app when it sees changes to local files:

```shell
npm ci
npm run dev
```

The tool is then at `http://localhost:3000`, or on the `PORT` you set.

### Tests and checks

```shell
npm test                                         # unit tests, against an in-memory CHT
REDIS_TEST_URL=redis://localhost:6379 npm test   # also runs the Redis store tests
npm run check                                    # type check
npm run build && npm start                       # the production build
```

## Environment Variables

The `.env.example` file has example values. The server refuses to start if a required variable is missing or invalid. Here's what they mean:

Variable | Description | Sample
-- | -- | --
`COOKIE_PRIVATE_KEY` | Required. Encrypts session tokens. At least 32 characters, and a production secret. Changing it logs everyone out. Suggest `openssl rand -hex 32` to generate | `4f1c…`
`WORKER_PRIVATE_KEY` | Required. Encrypts the tokens background jobs carry. At least 32 characters, different from `COOKIE_PRIVATE_KEY`, and a production secret | `9a0e…`
`SECRET_KEY` | Required. 64 hex characters, used to encrypt staged items and generated passwords | `eg. openssl rand -hex 32`
`REDIS_URL` | Required. The Redis server, the tool's only datastore. Use `rediss://` for TLS | `redis://localhost:6379`
`DEPLOYMENT_DIR` | Required. The deployment folder. See [Configuration](#configuration) | `config/deployments/chis-ke`
`PORT` | Port the web server listens on. Defaults to 3000 | `3000`
`CHT_DEV_INSTANCE` | A CHT instance to also offer outside production, as host and port | `localhost:5988`
`CHT_DEV_HTTP` | 'true' for http, otherwise https | `true`
`CHT_DEV_IDP_ORIGINS` | Comma-separated SSO identity providers for the dev instance | `http://localhost:8080`
`ALLOW_ADMIN_LOGIN` | Allow login for admin accounts. Defaults to true. | `true`
`SESSION_TTL` | Duration in seconds a login lasts. Keep it no longer than the instance's CouchDB session timeout. Defaults to 86400 (1 day) | `86400`
`CREDENTIALS_TTL` | Duration in seconds generated passwords can be seen again. Defaults to 432000 (5 days). | `432000`
`STAGED_LIST_TTL` | Duration in seconds a staged list is kept without changes. Defaults to 1209600 (14 days) | `1209600`
`BATCH_MAX_ITEMS` | Most staged items sent to CHT in one batch. Defaults to 100 | `100`
`MAX_PLACES_LOADED` | A place type with more places than this, eg. households, is only ever searched under a parent. Defaults to 10000 | `10000`
`MAX_SENTINEL_BACKLOG` | Max sentinel backlog count before the tool starts delaying move, merge and delete jobs. Defaults to 7000 | `7000`
`JOB_RECHECK` | Duration in seconds before a delayed job checks again. Defaults to 900 | `900`
`JOB_TTL` | Duration in seconds finished jobs are kept. Defaults to 2592000 (30 days) | `2592000`
`JOB_TIMEOUT` | Duration in seconds one cht-conf step of a job may take. Defaults to 14400 (4 hours) | `14400`
`CHT_CONF_HEAP_MB` | Memory, in megabytes, a job's cht-conf may use. Defaults to 2048 | `2048`
`JOB_WORK_DIR` | Where each job's working folder goes. Removed when the job ends | `/tmp/cht-iam-jobs`
`ARCHIVE_LOCATION` | Where copies of every deleted and merged doc are kept, so a delete can be undone | `data/archives`
`ARCHIVE_TTL` | Duration in seconds those copies are kept. Defaults to 2592000 (30 days) | `2592000`

## Development Process

This repo has an automated release process where each feature/bug fix will be released immediately after it is merged to main.

1. Create a ticket for the feature/bug fix.
2. Submit a PR, and make sure that the PR title is clear, readable, and follows the strict commit message format described in the commit message format section below. If the PR title does not comply, automatic release will fail.
3. Have the PR reviewed.
4. Squash and merge the PR to main. The commit message should be the already-formatted PR title but double check it's clear, readable, and follows the strict commit message format to make sure the automatic release works as expected.
5. Close the ticket.

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
