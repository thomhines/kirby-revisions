# Kirby Revisions

Preview, manage, and load previous versions of your pages from the Kirby panel.

`kirby-revisions` adds a `Revisions` button in the Panel for pages and site settings. Editors can save snapshots, browse older ones, and load a previous snapshot back into the current draft without publishing it live.

## Requirements

- Kirby `5.x`
- PHP `8.2+`

## What it does

- Adds a `Revisions` drawer in the Panel UI
- Lets editors save a revision on demand
- Creates revisions during normal save/autosave flow
- Lets editors load an older revision into the current draft
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

Each revision contains copies of the draft content files from `_changes`.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `thomhines.kirby-revisions.enabled` | `bool` | `true` | Enables or disables the plugin. |
| `thomhines.kirby-revisions.allowDelete` | `bool` | `true` | Shows delete controls in the Revisions drawer and enables delete routes. |
| `thomhines.kirby-revisions.max` | `int` | `200` | Maximum revisions stored per page/site model; oldest revisions are removed automatically when the limit is exceeded. |

## Notes

- Revisions are filesystem snapshots, not git commits.
- Make sure your content folders (where `_changes`/`_versions` live) are writable by PHP in production.

## License

MIT
