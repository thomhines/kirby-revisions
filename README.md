# Kirby Revisions

Save, preview, and restore page revisions from the Kirby Panel.

`kirby-revisions` adds a `Revisions` button in the Panel for pages and site settings. Editors can save snapshots, browse older ones, and load a previous snapshot back into the current draft without publishing it live.

## Requirements

- Kirby `5.x`
- PHP `8.2+`

## What it does

- Adds a `Revisions` drawer in the Panel UI
- Lets editors save a revision on demand (with optional label)
- Creates revisions during publish/save flow
- Lets editors load an older revision into the current draft
- Lets editors preview a selected revision in a new browser tab
- Lets editors add/edit labels for easier revision scanning
- Optionally allows deleting old revisions
- Keeps revision history trimmed automatically (based on `max`)

## Installation

### Option 1: Drop in the plugin folder

Place this plugin at:

`site/plugins/kirby-revisions`

### Option 2: Composer

```bash
composer require thomhines/kirby-revisions
```

### Option 3: Git submodule

```bash
git submodule add https://github.com/thomhines/kirby-revisions.git site/plugins/kirby-revisions
```

## Quick start

Install it and open the Panel on any page (or Site view). You will see a `Revisions` button that opens the revisions drawer.

The plugin works out of the box with sensible defaults.

If you want to customize behavior, add options in `site/config/config.php`:

```php
<?php

return [
	'thomhines.kirby-revisions.enabled' => true,
	'thomhines.kirby-revisions.allowDelete' => true,
	'thomhines.kirby-revisions.max' => 200,
];
```

## Where revisions are stored

Revisions are stored on disk in each model folder under `_versions`.

- Pages: `content/<page-id>/_versions/<revision-id>/...`
- Site settings: `content/_site/_versions/<revision-id>/...` (depends on your site model root)

Each revision stores model content files only (for example `page.txt`), not page assets/files.

For manual `Save Revision`, snapshots are created from `_changes` when available and fall back to current saved content when `_changes` does not exist or is empty.

Revision labels are saved in:

- `content/<model>/_versions/<revision-id>/.revision.json`

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `thomhines.kirby-revisions.enabled` | `bool` | `true` | Enables or disables the plugin. |
| `thomhines.kirby-revisions.allowDelete` | `bool` | `true` | Shows delete controls in the Revisions drawer and enables delete routes. |
| `thomhines.kirby-revisions.max` | `int` | `200` | Maximum revisions stored per page/site model; oldest revisions are removed automatically when the limit is exceeded. |

## Notes

- Revisions are filesystem snapshots, not git commits.
- Make sure your content folders (where `_changes`/`_versions` live) are writable by PHP in production.
- Revision preview opens a dedicated preview tab for the selected snapshot and does not overwrite your current draft.

## License

MIT
