<!-- Generated from the command tree by pnpm generate. Do not edit. -->

# Commands

Every command, option and exit code, generated from the program itself. For the same list as JSON, run
`b24 commands --json`.

**The first word is the profile**, a name you choose: `b24 personal config show`. `B24_PROFILE`
does the same for a whole shell session. No profile is assumed: a command that uses an account stops without one and
lists the profiles on this computer.

## Options for every command

| Option | What it does |
|---|---|
| `-V, --version` | output the version number. |
| `-v, --verbose` | more detail in what is shown: -v ids, -vv everything we know. Default: `0`. |
| `--json` | machine-readable output: one JSON value on stdout; --json=id,text keeps only those fields. |
| `--jsonl` | machine-readable output: one JSON object per line, for streaming and jq. |
| `--quiet` | diagnostics off; a failure is still said. |
| `--trace` | the connection's own log lines on stderr — never content. |
| `--debug` | on a failure, its whole record — cause and stack — in place of the short line. |
| `--timeout <duration>` | give up on the whole command after this — 30s, 2m, 500ms. |
| `--offline` | answer from what was recorded and never connect; fails if nothing was. |
| `--no-input` | never prompt or open interactive login; piped input remains available. |
| `--max-input-bytes <bytes>` | maximum buffered input bytes (default: 16777216). |
| `--max-output-bytes <bytes>` | maximum machine output bytes (default: 4194304; 0 disables). |
| `--brief` | found items as reference, title, time, author and excerpt only. |
| `--full` | found items with their whole text and every provider field. |
| `--compact` | one line per item for an agent: reference first, text last, paging and next steps as # lines. |
| `--dry-run` | preview parsed arguments and permissions before running the action. |
| `--yes` | go ahead without the question an ask level puts before a write. |
| `--record` | keep this run even where the config says record false; record_input false leaves the typed words out. |
| `--no-record` | do not keep this run, even if it fails. |

## `b24 commands`

every command by section; --json prints its contract, one path per call

### `b24 commands info`

one command contract, or all schemas, error reasons and explicit overrides

```sh
b24 commands info [path]
```

| Argument | | What it is |
|---|---|---|
| `path` | optional | one command path; without one, export schemas, error reasons and explicit overrides. |

**Returns:** one command contract, or all schemas, error reasons and explicit overrides

**Example:** `b24 commands info commands`

## `b24 session`

keep this profile's Bitrix24 webhook in the OS keyring

### `b24 session start`

sign this profile in: the incoming webhook's address (Bitrix24 → Developer resources → Other → Incoming webhook) is asked hidden or read from stdin, checked against the portal, and only then kept in the keyring, or in a private file when the keyring fails; the webhook acts with the rights of the employee who made it

**Changes something on this computer only.**

```sh
b24 session start [options]
```

| Option | What it does |
|---|---|
| `--credential-storage <storage>` | where the address is kept: keyring (the default, which falls back to a private file by itself when no keyring works), or file, not recommended. Default: `keyring`. |

**Returns:** sign in with a Bitrix24 incoming webhook

**Example:** `b24 work session start`, `b24 work session start --json`

### `b24 session status`

show where this profile's webhook address comes from: B24_TOKEN, the keyring or a file; never the address. --check asks the portal whose rights it carries: the user's id, name and whether they are an admin

```sh
b24 session status [options]
```

| Option | What it does |
|---|---|
| `--check` | ask the portal whether the webhook still works, and as whom. |

**Returns:** show where the webhook comes from, and with --check as whom it acts

**Example:** `b24 work session status`, `b24 work session status --check --json`

### `b24 session end`

forget this profile's webhook address on this computer; the webhook itself stays in Bitrix24

**Changes something on this computer only.**

```sh
b24 session end
```

**Returns:** forget this profile's webhook address on this computer

**Example:** `b24 work session end`

### `b24 session list`

list the profiles on this computer and whether each has a webhook; picks none

```sh
b24 session list
```

**Returns:** list the profiles here and whether each is signed in

**Example:** `b24 session list`, `b24 session list --json`

## `b24 deals`

read the portal's deals

### `b24 deals list`

list deals on the portal, newest first

```sh
b24 deals list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** deal — id, title, pipeline_id, stage_id, outcome, amount, currency, assigned_to, and 7 more; every field: b24 commands info deals list

**Example:** `b24 work deals list`, `b24 work deals list outcome:open pipeline_id:1 amount>=10000`

### `b24 deals show`

show one of the deals on the portal

```sh
b24 deals show <id-or-name>
```

| Argument | | What it is |
|---|---|---|
| `id-or-name` | required | the id-or-name as list prints it. |

**Returns:** deal — id, title, pipeline_id, stage_id, outcome, amount, currency, assigned_to, and 7 more; every field: b24 commands info deals show

**Example:** `b24 work deals show 42`, `b24 work deals show 42 --json`

### `b24 deals create`

create one deal on the portal

**Changes something in the service.**

```sh
b24 deals create [options]
```

| Option | What it does |
|---|---|
| `--title <title>` | the title. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** create one deal on the portal

**Example:** `b24 work deals create --title "Kitchen for Acme" --body '{"opportunity":15000,"currencyId":"EUR"}'`

### `b24 deals update`

change one deal on the portal; options left out keep their values

**Changes something in the service.**

```sh
b24 deals update <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the deal's id. |

| Option | What it does |
|---|---|
| `--title <title>` | the title. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** change one deal on the portal; options left out keep their values

**Example:** `b24 work deals update 42 --body '{"opportunity":18000}'`

### `b24 deals move`

move one deal to another stage

**Changes something in the service.**

```sh
b24 deals move <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the deal's id. |

| Option | What it does |
|---|---|
| `--stage <stage>` | the stage, by id or name, as `stages list` prints it. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** move one deal to another stage

**Example:** `b24 work deals move 42 --stage "Contract signed"`

## `b24 leads`

read the portal's leads

### `b24 leads list`

list leads on the portal, newest first

```sh
b24 leads list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** lead — id, title, name, organization_name, stage_id, outcome, amount, currency, and 10 more; every field: b24 commands info leads list

**Example:** `b24 work leads list`, `b24 work leads list outcome:open updated_at>=7d`

### `b24 leads show`

show one of the leads on the portal

```sh
b24 leads show <id-or-name>
```

| Argument | | What it is |
|---|---|---|
| `id-or-name` | required | the id-or-name as list prints it. |

**Returns:** lead — id, title, name, organization_name, stage_id, outcome, amount, currency, and 10 more; every field: b24 commands info leads show

**Example:** `b24 work leads show 42`, `b24 work leads show 42 --json`

### `b24 leads create`

create one lead on the portal

**Changes something in the service.**

```sh
b24 leads create [options]
```

| Option | What it does |
|---|---|
| `--title <title>` | the title. |
| `--first-name <name>` | the person's first name. |
| `--last-name <name>` | the person's last name. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** create one lead on the portal

**Example:** `b24 work leads create --title "Website form" --first-name Ivan`

### `b24 leads update`

change one lead on the portal; options left out keep their values

**Changes something in the service.**

```sh
b24 leads update <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the lead's id. |

| Option | What it does |
|---|---|
| `--title <title>` | the title. |
| `--first-name <name>` | the person's first name. |
| `--last-name <name>` | the person's last name. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** change one lead on the portal; options left out keep their values

**Example:** `b24 work leads update 7 --set Source=Website --set Tags=Hot --set Tags=Repeat`

### `b24 leads move`

move one lead to another stage

**Changes something in the service.**

```sh
b24 leads move <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the lead's id. |

| Option | What it does |
|---|---|
| `--stage <stage>` | the stage, by id or name, as `stages list` prints it. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** move one lead to another stage

**Example:** `b24 work leads move 7 --stage IN_PROCESS`

## `b24 people`

read the portal's contacts

### `b24 people list`

list contacts on the portal, newest first

```sh
b24 people list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** crm person — id, name, first_name, last_name, position, organization_ids, assigned_to, created_at, and 5 more; every field: b24 commands info people list

**Example:** `b24 work people list`, `b24 work people list name:ivan*`

### `b24 people show`

show one of the contacts on the portal

```sh
b24 people show <id-or-name>
```

| Argument | | What it is |
|---|---|---|
| `id-or-name` | required | the id-or-name as list prints it. |

**Returns:** crm person — id, name, first_name, last_name, position, organization_ids, assigned_to, created_at, and 5 more; every field: b24 commands info people show

**Example:** `b24 work people show 42`, `b24 work people show 42 --json`

### `b24 people create`

create one person on the portal

**Changes something in the service.**

```sh
b24 people create [options]
```

| Option | What it does |
|---|---|
| `--first-name <name>` | the person's first name. |
| `--last-name <name>` | the person's last name. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** create one person on the portal

**Example:** `b24 work people create --first-name Anna --last-name Ivanova`

### `b24 people update`

change one person on the portal; options left out keep their values

**Changes something in the service.**

```sh
b24 people update <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the person's id. |

| Option | What it does |
|---|---|
| `--first-name <name>` | the person's first name. |
| `--last-name <name>` | the person's last name. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** change one person on the portal; options left out keep their values

**Example:** `b24 work people update 4 --body '{"post":"Buyer"}'`

## `b24 organizations`

read the portal's companies

### `b24 organizations list`

list companies on the portal, newest first

```sh
b24 organizations list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** crm organization — id, name, type_id, industry_id, revenue, currency, person_ids, assigned_to, and 6 more; every field: b24 commands info organizations list

**Example:** `b24 work organizations list`, `b24 work organizations list name:acme*`

### `b24 organizations show`

show one of the companies on the portal

```sh
b24 organizations show <id-or-name>
```

| Argument | | What it is |
|---|---|---|
| `id-or-name` | required | the id-or-name as list prints it. |

**Returns:** crm organization — id, name, type_id, industry_id, revenue, currency, person_ids, assigned_to, and 6 more; every field: b24 commands info organizations show

**Example:** `b24 work organizations show 42`, `b24 work organizations show 42 --json`

### `b24 organizations create`

create one organization on the portal

**Changes something in the service.**

```sh
b24 organizations create [options]
```

| Option | What it does |
|---|---|
| `--name <name>` | the name. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** create one organization on the portal

**Example:** `b24 work organizations create --name "Acme"`

### `b24 organizations update`

change one organization on the portal; options left out keep their values

**Changes something in the service.**

```sh
b24 organizations update <id> [options]
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the organization's id. |

| Option | What it does |
|---|---|
| `--name <name>` | the name. |
| `--body <json>` | the other fields to set, as a JSON object in Bitrix24's REST 3.0 names: {"opportunity":15000,"currencyId":"EUR","assignedById":7,"stageId":"C1:NEW","phone":[{"valueTypeId":"WORK","value":"+1…"}]}; `api show crm.<type>.add` names them; assignedById other than the webhook's own user checks crm.assign-others. |
| `--set <field=value>` | a custom field, by its label or code as `fields list` prints them, and its value; a list field takes its option's label or id; repeat it for more fields, or for each value of a multiple field. Over --body for the same field; --dry-run does not look the names up. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |

**Returns:** change one organization on the portal; options left out keep their values

**Example:** `b24 work organizations update 9 --name "Acme Ltd"`

## `b24 pipelines`

read the portal's deal pipelines

### `b24 pipelines list`

list deal pipelines on the portal, newest first

```sh
b24 pipelines list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms; this list filters by none yet. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** pipeline — id, name, is_default, sort; every field: b24 commands info pipelines list

**Example:** `b24 work pipelines list`, `b24 work pipelines list --json`

### `b24 pipelines show`

show one of the deal pipelines on the portal

```sh
b24 pipelines show <id-or-name>
```

| Argument | | What it is |
|---|---|---|
| `id-or-name` | required | the id-or-name as list prints it. |

**Returns:** pipeline — id, name, is_default, sort; every field: b24 commands info pipelines show

**Example:** `b24 work pipelines show 42`, `b24 work pipelines show 42 --json`

## `b24 stages`

read the stages of the portal's deal pipelines and leads

### `b24 stages list`

list deal and lead stages, each with its outcome on the portal, newest first

```sh
b24 stages list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** stage — id, name, entity, pipeline_id, outcome, sort, color; every field: b24 commands info stages list

**Example:** `b24 work stages list`, `b24 work stages list entity:leads`

### `b24 stages show`

show one of the deal and lead stages, each with its outcome on the portal

```sh
b24 stages show <id-or-name>
```

| Argument | | What it is |
|---|---|---|
| `id-or-name` | required | the id-or-name as list prints it. |

**Returns:** stage — id, name, entity, pipeline_id, outcome, sort, color; every field: b24 commands info stages show

**Example:** `b24 work stages show 42`, `b24 work stages show 42 --json`

## `b24 products`

read the portal's product catalog

### `b24 products list`

list catalog products on the portal, newest first

```sh
b24 products list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** product — id, name, price, currency, active, section_id; every field: b24 commands info products list

**Example:** `b24 work products list`, `b24 work products list active:true name:chair*`

### `b24 products show`

show one of the catalog products on the portal

```sh
b24 products show <id>
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the id as list prints it. |

**Returns:** product — id, name, price, currency, active, section_id; every field: b24 commands info products show

**Example:** `b24 work products show 42`, `b24 work products show 42 --json`

## `b24 users`

read the portal's employees

### `b24 users list`

list employees on the portal, newest first

```sh
b24 users list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** user — id, name, email, position, active, department_ids; every field: b24 commands info users list

**Example:** `b24 work users list`, `b24 work users list active:true`

### `b24 users show`

show one of the employees on the portal

```sh
b24 users show <id>
```

| Argument | | What it is |
|---|---|---|
| `id` | required | the id as list prints it. |

**Returns:** user — id, name, email, position, active, department_ids; every field: b24 commands info users show

**Example:** `b24 work users show 42`, `b24 work users show 42 --json`

## `b24 fields`

read the portal's own fields on deals, leads, people and organizations

### `b24 fields list`

list the portal's custom fields of one kind, with a list field's options

```sh
b24 fields list <kind> [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `kind` | required | deals, leads, people, organizations. |
| `query` | optional | field:value terms; this list filters by none yet. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. |
| `--page <n>` | which page, starting at 1. |
| `--all` | every row, no paging. |

**Returns:** crm field — code, label, type, multiple, filterable, options; every field: b24 commands info fields list

**Example:** `b24 work fields list deals`, `b24 work fields list people --json`

## `b24 api`

see and call the Bitrix24 REST methods directly

### `b24 api list`

list the Bitrix24 methods b24's own commands call, with the REST version and permission of each

```sh
b24 api list [query]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

**Returns:** api method — name, rest, effect, scope, permission, default_level, also_checks; every field: b24 commands info api list

**Example:** `b24 personal api list`, `b24 personal api list scope:crm effect:write`

### `b24 api show`

show which REST version a method goes to, what it does and the permissions it checks; calls nothing

```sh
b24 api show <method>
```

| Argument | | What it is |
|---|---|---|
| `method` | required | the Bitrix24 method, such as crm.deal.list. |

**Returns:** show a method's REST version and permissions; calls nothing

**Example:** `b24 personal api show crm.deal.update --json`

### `b24 api call`

call one Bitrix24 method by name with its parameters as JSON; it checks api.<method>, and the command key a deal, lead, contact or company write does the same as

**Changes something in the service.**

```sh
b24 api call <method> [options]
```

| Argument | | What it is |
|---|---|---|
| `method` | required | the Bitrix24 method, such as crm.deal.list. |

| Option | What it does |
|---|---|
| `--body <json>` | the method's parameters, as a JSON object. |
| `--operation-id <id>` | the operation_id an outcome_unknown named: a retry Bitrix24 will not run twice. |
| `--dry-run` | show every permission this call checks, with its level, and call nothing. |

**Returns:** call one Bitrix24 method by name with JSON parameters

**Example:** `b24 work api call crm.deal.list --body '{"select":["id","title"],"pagination":{"limit":5}}'`, `b24 work api call crm.status.list --body '{"filter":{"ENTITY_ID":"STATUS"}}'`

## `b24 doctor`

check this installation: version, paths, config, profiles; no keyring or network

```sh
b24 doctor
```

**Returns:** check this installation: version, paths, config, profiles; no keyring or network

**Example:** `b24 doctor`, `b24 doctor --json`

## `b24 skill`

the instructions an agent is given for this tool

### `b24 skill show`

print SKILL.md — `b24 skill install` puts it where Claude Code, Codex, Gemini CLI and OpenClaw look for it, and where Hermes does on request; --for prints the copy already there

```sh
b24 skill show [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | print the copy installed for these agents instead of this version's. One of: `claude`, `agents`. |

**Returns:** print the tool's instructions for AI agents

**Example:** `b24 skill show`

### `b24 skill install`

write SKILL.md to \~/.claude/skills/bitrix24-cli/ (Claude Code) and \~/.agents/skills/bitrix24-cli/ (Codex, Gemini CLI, OpenClaw); --for hermes also has Hermes read \~/.agents/skills, which changes Hermes's own settings, so all leaves it out

**Changes something on this computer only.**

```sh
b24 skill install [options]
```

| Option | What it does |
|---|---|
| `--for <agents>` | which agents to install for. One of: `claude`, `agents`, `hermes`, `all`. Default: `all`. |

**Returns:** install the tool's instructions for AI agents

**Example:** `b24 skill install --for agents`

### `b24 skill status`

for each place `b24 skill install` writes to, and for the copy Hermes reads: the path, the version installed there, and whether it is current, stale, missing or unversioned

```sh
b24 skill status
```

**Returns:** whether the installed instructions for AI agents match this version

**Example:** `b24 skill status`, `b24 skill status --json`

## `b24 mcp`

serve this profile's commands to an agent over MCP — `claude mcp add b24 -- b24 personal mcp serve`

### `b24 mcp serve`

serve this profile's commands to an agent over MCP, on stdin and stdout, writes included; the profile's permissions decide — `claude mcp add b24 -- b24 personal mcp serve`

**Changes something in the service.**

```sh
b24 mcp serve [options]
```

| Option | What it does |
|---|---|
| `--http` | serve over HTTP on 127.0.0.1 for ChatGPT and Claude in the browser, behind your tunnel; the profile's permissions decide. |
| `--port <port>` | the local port for --http (default 8765). |
| `--public-url <url>` | the tunnel's https address the browser apps use, e.g. https://<name>.ts.net. |

**Returns:** serve this profile's commands to an AI agent

**Example:** `b24 personal mcp serve`, `b24 personal mcp serve --http --public-url https://laptop.example.ts.net`

### `b24 mcp revoke`

forget every login `mcp serve --http` gave a browser app; each must log in again

**Changes something on this computer only.**

```sh
b24 mcp revoke
```

**Returns:** forget every login given to a browser app

**Example:** `b24 personal mcp revoke`

### `b24 mcp server`

start, stop and check `mcp serve --http` in the background; status shows the login code for a browser app

#### `b24 mcp server start`

start `mcp serve --http` apart from this shell and answer once it listens, with its login code

**Changes something on this computer only.**

```sh
b24 mcp server start [options]
```

| Option | What it does |
|---|---|
| `--port <port>` | the local port (default 8765). |
| `--public-url <url>` | the tunnel's https address the browser apps use, e.g. https://<name>.ts.net or https://<name>.ts.net/tg. |

**Returns:** start the HTTP MCP server in the background

**Example:** `b24 personal mcp server start --public-url https://laptop.example.ts.net`

#### `b24 mcp server stop`

stop `mcp serve --http` — only one that `mcp server start` started

**Changes something on this computer only.**

```sh
b24 mcp server stop
```

**Returns:** stop the background HTTP MCP server

**Example:** `b24 personal mcp server stop`

#### `b24 mcp server status`

whether `mcp serve --http` runs, on which port and address, the login code for a new browser app, and the apps logged in

```sh
b24 mcp server status
```

**Returns:** whether the HTTP MCP server runs, its login code and the apps logged in

**Example:** `b24 personal mcp server status --json`

## `b24 upgrade`

upgrade b24 with the package manager that installed it; --check only looks

**Changes something on this computer only.**

```sh
b24 upgrade [options]
```

| Option | What it does |
|---|---|
| `--check` | say whether a newer version exists, and install nothing. |

**Returns:** upgrade b24 with the package manager that installed it; --check only looks

**Example:** `b24 upgrade --check`

## `b24 config`

the settings in force, and where each one came from

### `b24 config show`

the profile, the profiles that exist, and each setting with where it came from

```sh
b24 config show
```

**Returns:** the profile, the profiles that exist, and each setting with where it came from

**Example:** `b24 personal config show`

### `b24 config set`

save a setting to the configuration file

**Changes something on this computer only.**

```sh
b24 config set <setting> <value> [options]
```

| Argument | | What it is |
|---|---|---|
| `setting` | required | one of: limit, timeout_ms, color, record, record_input, keep_runs_for_days, keep_successful_runs_for_days, runs_size_limit_mb, permissions, requests_per_minute, search_reranker, embedding_provider, embedding_model, embedding_base_url, embedding_dims, models, update_check, skill_hint, search_stemmers.cyrillic, search_stemmers.latin. |
| `value` | required | a number, true or false; for a group tg:work,max:Alice,email:me@x. |

| Option | What it does |
|---|---|
| `--defaults` | change what every profile gets, rather than this profile. |

**Returns:** save a setting to the configuration file

**Example:** `b24 personal config set limit 20`

### `b24 config unset`

remove a setting from the configuration file

**Changes something on this computer only.**

```sh
b24 config unset <setting> [options]
```

| Argument | | What it is |
|---|---|---|
| `setting` | required | one of: limit, timeout_ms, color, record, record_input, keep_runs_for_days, keep_successful_runs_for_days, runs_size_limit_mb, permissions, requests_per_minute, search_reranker, embedding_provider, embedding_model, embedding_base_url, embedding_dims, models, update_check, skill_hint, search_stemmers.cyrillic, search_stemmers.latin. |

| Option | What it does |
|---|---|
| `--defaults` | change what every profile gets, rather than this profile. |

**Returns:** remove a setting from the configuration file

**Example:** `b24 personal config unset limit`

### `b24 config migrate`

write each setting the file lacks at its default, keeping yours

**Changes something on this computer only.**

```sh
b24 config migrate
```

**Returns:** write each setting the file lacks at its default, keeping yours

**Example:** `b24 config migrate`

### `b24 config repair`

fix broken JSON syntax in the settings file — comments, a missing or extra comma, unquoted keys, single quotes, missing closing brackets at the end — keeping every value, with a backup beside it; refuses anything with more than one reading and changes nothing then

**Changes something on this computer only.**

```sh
b24 config repair [options]
```

| Option | What it does |
|---|---|
| `--dry-run` | say what it would fix, and change nothing. |

**Returns:** fix the settings file's JSON syntax, keeping every value

**Example:** `b24 config repair`, `b24 config repair --dry-run`

## `b24 runs`

recorded runs — what this tool did, and when

### `b24 runs list`

recorded runs, newest first

```sh
b24 runs list [query] [options]
```

| Argument | | What it is |
|---|---|---|
| `query` | optional | field:value terms that narrow the list — the fields are below. |

| Option | What it does |
|---|---|
| `--limit <n>` | how many to show. Default: `20`. |
| `--page <n>` | which page, starting at 1. Default: `1`. |

**Returns:** run — run_id, command, started_at, status, cli_version, profile, completed_at, requests, and 23 more; every field: b24 commands info runs list

**Example:** `b24 personal runs list --limit 10`

### `b24 runs show`

one run: what it was, how it ended, and every event it logged

```sh
b24 runs show <run-id> [options]
```

| Argument | | What it is |
|---|---|---|
| `run-id` | required | an id from `b24 runs list`. |

| Option | What it does |
|---|---|
| `--problems` | only failed responses, warnings and crashes. |

**Returns:** run details — run_id, command, started_at, status, cli_version, directory, event_count, events, and 22 more; every field: b24 commands info runs show

**Example:** `b24 personal runs show run-101`

### `b24 runs path`

the directory holding one run

```sh
b24 runs path <run-id>
```

| Argument | | What it is |
|---|---|---|
| `run-id` | required | an id from `b24 runs list`. |

**Returns:** run location — path; every field: b24 commands info runs path

**Example:** `b24 personal runs path run-101`

## Exit codes

Branch on the code, not on the text: the text can change, the code does not.

| Code | When |
|---|---|
| `0` | it worked |
| `2` | `validation_error` |
| `3` | `configuration_error` |
| `4` | `authentication_error` |
| `5` | `permission_error` |
| `6` | `not_found` |
| `7` | `confirmation_required` |
| `8` | `rate_limited` |
| `9` | `timeout` |
| `10` | `network_error` |
| `11` | `provider_error` |
| `12` | `provider_unavailable` |
| `13` | `invalid_response` |
| `14` | `outcome_unknown` |
| `15` | `conflict` |
| `130` | `cancelled` |
| `1` | anything else |
